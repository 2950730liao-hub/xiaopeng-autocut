import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {copyFile,link,mkdir,mkdtemp,readFile,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {cacheKey,fileKey,writeCached} from './video-cache.mjs';

export const local=path.dirname(fileURLToPath(import.meta.url));
export const gsapVersion='3.14.2';
const hyperframesVersion='0.9.72';
const elapsed=start=>+((performance.now()-start)/1000).toFixed(2);

function command(bin,args,{timeout=120_000,cwd}={}){
  const result=spawnSync(bin,args,{timeout,cwd,encoding:'utf8',maxBuffer:8*1024*1024});
  if(result.error) throw new Error(`${bin} ${args[0]}: ${result.error.message}`);
  assert.equal(result.status,0,`${bin} ${args[0]}: ${(result.stderr??result.stdout??'').slice(-2400)}`);
  return result.stdout.trim();
}

export function remotionRuntime(){
  const modules=path.resolve(process.env.XIAOPENG_REMOTION_MODULES??path.join(local,'node_modules'));
  return {modules,cli:path.join(modules,'@remotion','cli','remotion-cli.js')};
}

export function hyperframesRuntime(){
  const bin=process.env.XIAOPENG_HYPERFRAMES_BIN??(process.platform==='win32'?'npx.cmd':'npx');
  return {bin,args:process.env.XIAOPENG_HYPERFRAMES_BIN?[]:['--yes',`hyperframes@${hyperframesVersion}`]};
}

export function configureBrowser(){
  if(process.env.HYPERFRAMES_BROWSER_PATH) return process.env.HYPERFRAMES_BROWSER_PATH;
  const app=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
  if(app) process.env.HYPERFRAMES_BROWSER_PATH=app;
  return app;
}

export async function stageGsap(dir){
  if(process.env.XIAOPENG_GSAP_FILE) return path.resolve(process.env.XIAOPENG_GSAP_FILE);
  const installed=path.join(remotionRuntime().modules,'gsap','dist','gsap.min.js');
  if(existsSync(installed)) return installed;
  const file=path.join(dir,`gsap-${gsapVersion}.min.js`);
  if(!existsSync(file)){
    const response=await fetch(`https://cdn.jsdelivr.net/npm/gsap@${gsapVersion}/dist/gsap.min.js`,
      {signal:AbortSignal.timeout(20_000)});
    assert(response.ok,'Could not get pinned GSAP');
    const bytes=Buffer.from(await response.arrayBuffer());
    await writeCached(file,temp=>writeFile(temp,bytes));
  }
  return file;
}

/** Warm once before dispatch. Only successful bundles become visible to workers. */
export async function warmRenderers({motion}){
  const started=performance.now();
  const browser=configureBrowser();
  const cache=path.resolve(process.env.XIAOPENG_RENDER_CACHE??path.join(homedir(),'.cache','xiaopeng-autocut'));
  await mkdir(cache,{recursive:true,mode:0o700});
  const gsap=await stageGsap(cache);
  const {bin,args}=hyperframesRuntime();
  const hyperStart=performance.now();
  const hf=command(bin,[...args,'--version'],{timeout:45_000});
  const browserVersion=browser?command(browser,['--version'],{timeout:12_000}):'HyperFrames managed browser';
  if(browser) await probeBrowser(browser,cache);
  else command(bin,[...args,'browser','ensure'],{timeout:90_000});
  const hyperframesSeconds=elapsed(hyperStart);
  let bundle, bundleHit=false, remotionSeconds=0, remotionBuild;
  if(motion){
    const {modules,cli}=remotionRuntime();
    assert(existsSync(cli),'Install the locked Remotion dependencies or set XIAOPENG_REMOTION_MODULES');
    const remStart=performance.now();
    remotionBuild=await fileKey(path.join(modules,'@remotion','cli','package.json'));
    const source=path.join(local,'motion.tsx');
    const identity=cacheKey([await fileKey(source),remotionBuild,await fileKey(path.join(local,'package-lock.json'))]);
    bundle=path.join(cache,'bundles',identity);
    await withWarmupLock(cache,modules,async ()=>{
      bundleHit=existsSync(path.join(bundle,'index.html'));
      const override=process.env.XIAOPENG_CHROME;
      if(override) command(override,['--version'],{timeout:12_000});
      else command(process.execPath,[cli,'browser','ensure'],{timeout:100_000,cwd:path.dirname(modules)});
      if(!bundleHit) await buildBundle(bundle,source,modules,cli);
    });
    remotionSeconds=elapsed(remStart);
  }
  const fingerprint=cacheKey([hf,browserVersion,await fileKey(gsap),remotionBuild,
    process.env.XIAOPENG_CHROME??'',process.env.XIAOPENG_RENDER_PROFILE??'']);
  return {env:{XIAOPENG_GSAP_FILE:gsap,XIAOPENG_RENDER_BUNDLE:bundle??'',
    XIAOPENG_RENDER_RUNTIME:fingerprint}, report:{seconds:elapsed(started),hyperframesSeconds,remotionSeconds,bundleHit}};
}

async function withWarmupLock(cache,modules,operation){
  const lock=path.join(cache,`warm-${cacheKey(modules)}.lock`);
  const claimant=await mkdtemp(path.join(cache,'warm-owner-'));
  const owner=path.join(claimant,'pid');
  let acquired=false;
  try{
    await writeFile(owner,String(process.pid));
    const deadline=performance.now()+240_000;
    while(!acquired){
      try{
        await link(owner,lock);
        acquired=true;
      } catch(error){
        if(error.code!=='EEXIST') throw error;
        assert(performance.now()<deadline,'Another renderer is still preparing its browser or bundle');
        const observed=await readFile(lock,'utf8').catch(error=>{
          if(error.code==='ENOENT') return '';
          throw error;
        });
        const pid=Number(observed);
        if(Number.isSafeInteger(pid)&&pid>0){
          try{ process.kill(pid,0); }
          catch(error){
            if(error.code==='ESRCH'&&await readFile(lock,'utf8').catch(()=>null)===observed)
              await rm(lock,{force:true});
          }
        }
        await delay(170);
      }
    }
    return await operation();
  } finally {
    if(acquired) await rm(lock,{force:true});
    await rm(claimant,{force:true,recursive:true});
  }
}

async function probeBrowser(browser,cache){
  // Use a process-local profile and never touch the user's interactive browser profile.
  const profile=await mkdtemp(path.join(cache,'warm-chrome-'));
  try{
    command(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
      '--dump-dom',`--user-data-dir=${profile}`,'data:text/html,<title>autocut-warm</title>'],{timeout:18_000});
  } finally { await rm(profile,{recursive:true,force:true}); }
}

async function buildBundle(bundle,source,modules,cli){
  await mkdir(path.dirname(bundle),{recursive:true});
  const work=await mkdtemp(path.join(path.dirname(bundle),'bundle-'));
  try{
    await symlink(modules,path.join(work,'node_modules'),'junction');
    const entry=path.join(work,'motion.tsx');
    await copyFile(source,entry);
    const compiled=path.join(work,'compiled');
    command(process.execPath,[cli,'bundle',entry,`--out-dir=${compiled}`,'--log=warn'],{cwd:work});
    assert(existsSync(path.join(compiled,'index.html')),'Remotion bundle did not produce index.html');
    try { await rename(compiled,bundle); }
    catch(error){ if(!existsSync(path.join(bundle,'index.html'))) throw error; }
  } finally { await rm(work,{recursive:true,force:true}); }
}

export async function prepareCaptionBundle(){
  const {modules,cli}=remotionRuntime();
  const source=path.join(local,'caption-overlay.tsx');
  const cache=path.resolve(process.env.XIAOPENG_RENDER_CACHE??path.join(homedir(),'.cache','xiaopeng-autocut'));
  await mkdir(cache,{recursive:true,mode:0o700});
  const identity=cacheKey([await fileKey(source),await fileKey(path.join(modules,'@remotion','cli','package.json')),
    await fileKey(path.join(local,'package-lock.json'))]);
  const bundle=path.join(cache,'bundles',identity);
  let bundleHit;
  await withWarmupLock(cache,modules,async ()=>{
    bundleHit=existsSync(path.join(bundle,'index.html'));
    if(!bundleHit) await buildBundle(bundle,source,modules,cli);
  });
  return {bundle,bundleHit};
}

import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createWriteStream,existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {configureBrowser,warmRenderers} from './render-runtime.mjs';
import {cacheKey,fileKey,writeCached} from './video-cache.mjs';

const [manifestFile,destination,...extra]=process.argv.slice(2);
assert(manifestFile&&destination&&!extra.length,'Usage: batch-video.mjs BATCH.json OUT');
const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
const concurrent=manifest.concurrency??2;
const preview=manifest.preview===true;
assert(Number.isInteger(concurrent)&&concurrent>=1&&concurrent<=8,'concurrency must be 1–8');
assert(Array.isArray(manifest.jobs)&&manifest.jobs.length,'A batch needs jobs');
const ids=new Set();
for(const row of manifest.jobs){
  assert(typeof row.id==='string'&&/^[\p{L}\p{N}_-]+$/u.test(row.id)&&!ids.has(row.id),'Unique simple job id required');
  assert(['talk','script','montage'].includes(row.mode)&&typeof row.job==='string','Invalid batch job');
  ids.add(row.id);
}
const started=performance.now();
const secondsSince=start=>+((performance.now()-start)/1000).toFixed(2);
configureBrowser();
const root=path.resolve(destination);
const base=path.dirname(path.resolve(manifestFile));
const entry=fileURLToPath(new URL('create-video.mjs',import.meta.url));
const code=await Promise.all(['create-video.mjs','video-scenes.mjs','video-plan.mjs','video-audio.mjs',
  'video-services.mjs','video-cache.mjs','render-runtime.mjs','workflow-view.mjs','motion.tsx','batch-video.mjs'].map(file=>fileKey(fileURLToPath(new URL(file,import.meta.url)))));
const music=(manifest.music??[]).filter(track=>track.approved===true)
  .map(track=>({...track,file:path.resolve(base,track.file)}));
const jobs=[];
const uses=new Map();
let lastMusic;
for(const row of manifest.jobs){
  let selected;
  if(row.mode!=='talk'&&music.length){
    const different=music.filter(track=>track.file!==lastMusic);
    const preferred=different.filter(track=>!row.mood||track.moods?.includes(row.mood));
    const eligible=preferred.length?preferred:different.length?different:music;
    selected=[...eligible].sort((a,b)=>(uses.get(a.file)??0)-(uses.get(b.file)??0))[0];
    uses.set(selected.file,(uses.get(selected.file)??0)+1);
    lastMusic=selected.file;
  }
  jobs.push({...row,selected,jobFile:path.resolve(base,row.job)});
}

async function inputsKey(row,job){
  // A prepared talking-head project may be modified independently of its job file.
  if(row.mode==='talk') return undefined;
  const dir=path.dirname(row.jobFile);
  const sources=[...(job.materials??[]).map(asset=>asset.file),...(job.sceneAssets??[]).map(asset=>asset.file),
    job.previewVoice?.audio,job.previewVoice?.alignment,job.captionsAss,
    ...((job.audio?.effects??[]).map(effect=>effect.file)),
    job.audio?.music===undefined?row.selected?.file:job.audio?.music?.file].filter(Boolean);
  const digests=await Promise.all(sources.map(file=>fileKey(path.resolve(dir,file))));
  return cacheKey([code,preview,row.mode,job,row.selected,digests,process.env.XIAOPENG_RENDER_PROFILE??'',
    process.env.XIAOPENG_CAPTIONS_BIN??'',process.env.XIAOPENG_CHROME??'',process.env.HYPERFRAMES_BROWSER_PATH??'',
    process.env.XIAOPENG_HYPERFRAMES_BIN??'',process.env.XIAOPENG_REMOTION_MODULES??'',
    process.env.XIAOPENG_GSAP_FILE?await fileKey(process.env.XIAOPENG_GSAP_FILE):'pinned-gsap']);
}

async function prepare(row){
  const out=path.join(root,row.id);
  await mkdir(out,{recursive:true,mode:0o700});
  const job=JSON.parse(await readFile(row.jobFile,'utf8'));
  const signature=await inputsKey(row,job);
  const receipt=path.join(out,'batch-item.json');
  const output=path.join(out,preview?'preview.mp4':'video.mp4');
  if(signature&&existsSync(receipt)&&existsSync(output)){
    const saved=await readFile(receipt,'utf8').then(JSON.parse).catch(()=>null);
    if(saved?.signature===signature&&saved.status==='done'&&saved.outputSha256===await fileKey(output)){
      return {reused:{...saved,status:'reused',originalSeconds:saved.seconds,seconds:0,queueSeconds:0}};
    }
  }
  return {row,out,job,signature,receipt,output,queuedAt:performance.now()};
}

async function execute({row,out,signature,receipt,output,queuedAt},runtimeEnv){
  const started=performance.now();
  const queueSeconds=secondsSince(queuedAt);
  const log=createWriteStream(path.join(out,'run.log'));
  const status=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[entry,row.mode,row.jobFile,out,...(preview?['--preview']:[])],{
      env:{...process.env,...runtimeEnv,
        XIAOPENG_HYPERFRAMES_WORKERS:process.env.XIAOPENG_HYPERFRAMES_WORKERS??(concurrent>1?'1':'2'),
        XIAOPENG_SHOT_CACHE:process.env.XIAOPENG_SHOT_CACHE??path.join(root,'shot-cache'),
        XIAOPENG_VOICE_CACHE:process.env.XIAOPENG_VOICE_CACHE??path.join(root,'voice-cache'),XIAOPENG_BATCH_MUSIC:row.selected?JSON.stringify(row.selected):''},
      stdio:['ignore','pipe','pipe'],
    });
    child.stdout.pipe(log,{end:false});
    child.stderr.pipe(log,{end:false});
    child.on('error',reject);
    child.on('close',code=>log.end(()=>resolve(code)));
  });
  if(status!==0) throw new Error(`Exit ${status}. See run.log`);
  const report=JSON.parse(await readFile(path.join(out,'report.json'),'utf8'));
  const info={id:row.id,status:'done',signature,outputSha256:await fileKey(output),
    seconds:secondsSince(started),queueSeconds,report};
  await writeCached(receipt,temp=>writeFile(temp,JSON.stringify(info,null,2)+'\n'));
  return info;
}

const results=[];
const pending=[];
for(const [index,row] of jobs.entries()){
  try{
    const item=await prepare(row);
    if(item.reused) results[index]=item.reused;
    else pending.push({index,item});
  } catch(error){ results[index]={id:row.id,status:'failed',error:error.message}; }
}
const renderJobs=pending.filter(({item})=>item.row.mode!=='talk');
let warm={env:{},report:{seconds:0,skipped:true}};
let warmError;
if(renderJobs.length){
  const warmStart=performance.now();
  try{
    warm=await warmRenderers({motion:renderJobs.some(({item})=>item.job.scenes?.some(scene=>scene.motion||scene.workflow))});
  } catch(error){
    warmError=error.message;
    warm.report={seconds:secondsSince(warmStart),error:warmError};
  }
}
let next=0;
async function worker(){
  while(next<pending.length){
    const {index,item}=pending[next++];
    try{
      if(warmError&&item.row.mode!=='talk') throw new Error(warmError);
      results[index]=await execute(item,warm.env);
    } catch(error){
      results[index]={id:item.row.id,status:'failed',error:error.message};
    }
  }
}
await mkdir(root,{recursive:true,mode:0o700});
await Promise.all(Array.from({length:Math.min(pending.length,concurrent)},worker));
const summary={preview,concurrency:concurrent,warmup:warm.report,seconds:secondsSince(started),jobs:results};
await writeCached(path.join(root,'batch-report.json'),temp=>writeFile(temp,JSON.stringify(summary,null,2)+'\n'));
console.log(JSON.stringify(summary,null,2));
if(results.some(result=>result.status==='failed')) process.exitCode=1;

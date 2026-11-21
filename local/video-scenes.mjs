import assert from 'node:assert/strict';
import {copyFile,mkdir,symlink,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {FPS,WIDTH,HEIGHT} from './video-plan.mjs';
import {run} from './mux.mjs';
import {cacheKey,fileKey,writeCached} from './video-cache.mjs';
import {configureBrowser,hyperframesRuntime,remotionRuntime,stageGsap} from './render-runtime.mjs';
import {workflowCss,workflowMarkup,workflowMotion,workflowGsap,storyCss,storyMarkup,storyGsap,baseFrames} from './workflow-view.mjs';

const installedHere=path.dirname(fileURLToPath(import.meta.url));
const imageExt=new Set(['.jpg','.jpeg','.png','.webp']);
const videoExt=new Set(['.mp4','.m4v','.mov','.webm','.mkv']);
const seconds=frame=>(frame/FPS).toFixed(6);
const html=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);

async function stageMedia(material,scene,dir,index,wide){
  const ext=path.extname(material.file).toLowerCase();
  assert(imageExt.has(ext)||videoExt.has(ext),'Unsupported material format: '+ext);
  const name=`media-${index}`;
  if(imageExt.has(ext)){
    const relative=`assets/${name}${ext}`;
    await copyFile(material.file,path.join(dir,relative));
    return {relative,video:false};
  }
  const relative=`assets/${name}.mp4`;
  const trim=scene.trim??0;
  const sourceDuration=mediaDuration(material.file,'v:0');
  assert(trim<sourceDuration,'Scene trim is outside its source video');
  const size=wide?'650:454':'558:520';
  run('ffmpeg',['-nostdin','-v','error','-y','-ss',String(trim),'-i',material.file,'-map','0:v:0','-an',
    '-vf',`fps=${FPS},scale=${size}:force_original_aspect_ratio=increase,crop=${size},setsar=1,tpad=stop_mode=clone:stop_duration=${seconds(scene.length)}`,
    '-frames:v',String(scene.length),'-c:v','libx264','-preset','fast','-pix_fmt','yuv420p',path.join(dir,relative)]);
  return {relative,video:true};
}

export function mediaDuration(file,selector){
  const select=selector?['-select_streams',selector]:[];
  const result=run('ffprobe',['-v','error',...select,'-show_entries',
    'format=duration:stream=index,duration','-of','json',file],true,true);
  const meta=JSON.parse(result);
  if(selector) assert(meta.streams.length,`Missing ${selector} stream`);
  const value=Number((selector?meta.streams[0].duration:undefined)??meta.format.duration);
  assert(Number.isFinite(value)&&value>0,'Invalid media duration');
  return value;
}

async function remotionClip(dir,index,composition,props,alpha=false){
  const {modules,cli}=remotionRuntime();
  assert(existsSync(cli),'Install the locked Remotion dependencies or set XIAOPENG_REMOTION_MODULES');
  const project=path.join(dir,'motion-project');
  await mkdir(project,{recursive:true});
  let entry=process.env.XIAOPENG_RENDER_BUNDLE;
  if(!entry){
    const modulesLink=path.join(project,'node_modules');
    if(!existsSync(modulesLink)) await symlink(modules,modulesLink,'junction');
    entry=path.join(project,'motion.tsx');
    await copyFile(path.join(installedHere,'motion.tsx'),entry);
  }
  const propsFile=path.join(project,`props-${index}.json`);
  await writeFile(propsFile,JSON.stringify(props));
  const output=path.join(project,`animated-${index}.${alpha?'mov':'mp4'}`);
  const browser=process.env.XIAOPENG_CHROME?['--browser-executable='+process.env.XIAOPENG_CHROME]:[];
  const codec=alpha?['--image-format=png','--pixel-format=yuva444p10le','--codec=prores','--prores-profile=4444']:[];
  run(process.execPath,[cli,'render',entry,composition,output,'--props='+propsFile,
    '--muted','--concurrency=2','--log=warn',...codec,...browser],false,false,path.dirname(modules));
  return output;
}

async function motionClip(scene,dir,index){
  const transitionFrames=12;
  const animatedFrames=Math.min(scene.length,transitionFrames+1);
  const animated=await remotionClip(dir,index,'XiaopengMotion',{...scene.motion,frames:animatedFrames,transitionFrames});
  const relative=`assets/motion-${index}.mp4`;
  const clip=path.join(dir,relative);
  const tailFrames=scene.length-animatedFrames;
  if(tailFrames>0){
    run('ffmpeg',['-nostdin','-v','error','-y','-i',animated,'-an','-vf',`tpad=stop_mode=clone:stop=${tailFrames}`,
      '-frames:v',String(scene.length),'-c:v','libx264','-crf','17','-pix_fmt','yuv420p','-preset','fast',clip]);
  } else await copyFile(animated,clip);
  return {relative,video:true};
}

async function workflowOverlay(scene,dir,index){
  const timing=workflowMotion(scene);
  const w=scene.workflow;
  return remotionClip(dir,index,'WorkflowOverlay',{...timing,frames:Math.min(scene.length,timing.write+19),
    terms:w.clauses.map(term=>Array.from(term).length),id:w.id,action:w.action??'确认并写回',result:w.result,
    savedStatus:w.savedStatus??'已回复'},true);
}

function attr(id,scene,track){
  return `id="${id}" data-start="${seconds(scene.from)}" data-duration="${seconds(scene.length)}" data-track-index="${track}"`;
}

function demoHtml(scene,index){
  const {id,request,status,detail,focus}=scene.demo;
  const states=[['request','客户请求',request],['evidence','规则依据',scene.demo.evidence??'等待查询'],
    ['approval','客服确认',scene.demo.approval??'尚未确认'],['result','系统记录',scene.demo.result??'尚未写回']];
  const content=states.map(([key,label,value])=>`<div class="demo-field${key===focus?' focus':''}"><b>${label}</b><p>${html(value)}</p></div>`).join('');
  return `<article class="clip demo" ${attr('demo-'+index,scene,2)}>
    <div class="demo-bar"><span>售后工单 · ${html(id)}</span><strong>${html(status)}</strong></div>
    <div class="demo-grid">${content}</div>
    <div class="demo-foot"><span>教学示意</span><b>${html(detail)}</b></div>
  </article>`;
}

function compareHtml(scene,index){
  const {before,after,basis}=scene.compare;
  return `<article class="clip demo" ${attr('compare-'+index,scene,2)}>
    <div class="demo-bar"><span>流程对比</span></div>
    <div class="demo-grid"><div class="demo-field"><b>之前</b><p>${html(before)}</p></div>
    <div class="demo-field focus"><b>之后</b><p>${html(after)}</p></div></div>
    <div class="demo-foot"><b>${html(basis)}</b></div>
  </article>`;
}

function dataHtml(scene,index){
  const {label,before,after,unit,detail}=scene.data;
  const max=Math.max(before,after);
  const bars=[['之前',before],['试点',after]].map(([text,value])=>
    `<div class="data-row"><span>${text}</span><div class="data-track">
      <div class="data-bar" style="width:${value/max*100}%"></div>
    </div><b>${value} ${html(unit)}</b></div>`).join('');
  return `<article class="clip demo" ${attr('data-'+index,scene,2)}>
    <div class="demo-bar"><span>${html(label)}</span></div>
    <div class="data-rows">${bars}</div><div class="demo-foot"><b>${html(detail)}</b></div>
  </article>`;
}

function buildHtml(scenes,{width,height,look}){
  const total=scenes.at(-1).from+scenes.at(-1).length;
  const wide=width>height;
  const x=wide?1280:WIDTH, y=wide?720:HEIGHT;
  const layers=scenes.map((scene,i)=>{
    const id=`scene-${i}`;
    const at=seconds(scene.from);
    if(scene.workflow) return workflowMarkup(scene,id,attr,html);
    if(scene.story) return storyMarkup(scene,id,attr,html);
    const title=html(scene.title??Array.from(scene.text.split(/[，、。！？；,.!?]/u)[0]||scene.text).slice(0,14).join(''));
    const caption=`<h1 class="clip text ${scene.demo||scene.compare||scene.data?'for-demo':scene.media?'has-media':''}" ${attr(id,scene,1)}>${title}</h1>`;
    const media=scene.demo?demoHtml(scene,i):scene.compare?compareHtml(scene,i):scene.data?dataHtml(scene,i):scene.media?.video
      ?`<video muted playsinline class="clip media" ${attr('image-'+i,scene,2)} src="${scene.media.relative}"></video>`
      :scene.media?`<div class="clip media" ${attr('image-'+i,scene,2)} style="background:center / cover no-repeat url(${scene.media.relative})"></div>`:'';
    const motion=scene.motionMedia?`<video muted playsinline class="clip motion ${scene.media?'motion-with-media':''}" ${attr('motion-'+i,scene,3)} src="${scene.motionMedia.relative}"></video>`:'';
    const sweep=scene.sweep?`<aside class="clip sweep" id="sweep-${i}" data-start="${at}" data-duration="${seconds(Math.min(scene.length,8))}" data-track-index="4"></aside>`:'';
    return caption+media+motion+sweep;
  }).join('\n');
  const timings=scenes.map((scene,i)=>{
    const start=seconds(scene.from);
    if(scene.workflow) return workflowGsap(scene,'scene-'+i,FPS);
    if(scene.story) return storyGsap(scene,'scene-'+i,FPS);
    const ease=Math.min(scene.length/FPS,.25);
    return `tl.from("#scene-${i}",{y:28,opacity:0,duration:${ease},ease:"power2.out"},${start});
    ${scene.media?`tl.from("#image-${i}",{opacity:0,duration:${ease}},${start});`:''}
    ${scene.demo?`tl.from("#demo-${i} .focus",{y:6,opacity:0.56,duration:${ease},ease:"power2.out"},${start});`:''}
    ${scene.compare?`tl.from("#compare-${i} .focus",{x:14,opacity:0.56,duration:${ease},ease:"power2.out"},${start});`:''}
    ${scene.data?`tl.from("#data-${i} .data-bar",{scaleX:0.03,duration:${Math.min(scene.length/FPS,.5)},ease:"power2.out"},${start});`:''}
    ${scene.motionMedia?`tl.from("#motion-${i}",{opacity:0,duration:${ease}},${start});`:''}
    ${scene.sweep?`tl.fromTo("#sweep-${i}",{x:-${x}},{x:${x},duration:${Math.min(scene.length,8)/FPS},ease:"power2.inOut"},${start});`:''}`;
  }).join('\n');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>小芃自动剪辑</title><script src="assets/gsap.min.js"></script>
<style>
@font-face{font-family:XiaopengTitle;src:local("Songti SC"),local("Noto Serif CJK SC")}
*{box-sizing:border-box}body{margin:0;background:#f4ecdb}
#xiaopeng{position:relative;width:${width}px;height:${height}px;overflow:hidden;color:#18362d;background:#f4ecdb}
#stage{position:absolute;inset:0;width:${x}px;height:${y}px;transform:scale(${width/x});transform-origin:0 0}
.margin{position:absolute;inset:34px;border:1px solid #c7ccba;border-radius:34px}
.text{position:absolute;top:165px;left:81px;right:81px;z-index:1;margin:0;
  font:700 67px/1.22 XiaopengTitle,serif;overflow-wrap:anywhere}
.text::before{content:"";display:block;height:5px;width:72px;border-radius:6px;background:#b8452b;margin-bottom:30px}
.has-media{top:100px;font-size:49px}
.media,.motion{position:absolute;object-fit:cover;border-radius:24px;z-index:2}
.media{left:81px;top:335px;width:558px;height:520px}
.motion{left:81px;top:565px;width:558px;height:372px;z-index:3}
.motion-with-media{left:232px;top:822px;width:407px;height:271px}
.sweep{position:absolute;inset:0;z-index:5;background:#ede1cd;pointer-events:none}
.wide .margin{inset:27px;border-radius:26px}
.wide .text{top:132px;left:76px;right:76px;max-width:440px;font-size:63px}
.wide .has-media,.wide .for-demo{right:auto;width:290px;font-size:54px}
.wide .media{left:497px;top:95px;width:650px;height:454px}
.wide .motion{left:595px;top:135px;width:540px;height:360px}
.wide .motion-with-media{left:657px;top:384px;width:375px;height:250px}
.demo{position:absolute;left:405px;right:70px;top:70px;padding:27px;border-radius:22px;
  background:#fbf8f1;border:1px solid #d0d7ca;box-shadow:0 18px 42px #18362d24;z-index:2;
  font-family:sans-serif;color:#18362d}
.demo-bar,.demo-foot{display:flex;justify-content:space-between;align-items:center;gap:12px}
.demo-bar{font-size:23px;padding-bottom:19px;border-bottom:1px solid #d0d7ca}
.demo-bar strong{font-size:18px;background:#e1ead8;color:#204b39;border-radius:30px;padding:7px 13px}
.demo-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}
.demo-field{padding:15px;border-radius:12px;background:#f2efe6;border:1px solid #e2dfd3;min-height:103px}
.demo-field.focus{border-color:#b8452b;background:#f8e8d9;box-shadow:inset 4px 0 #b8452b}
.demo-field b{font-size:16px;color:#426352}
.demo-field p{margin:7px 0 0;font-size:23px;line-height:1.23;overflow-wrap:anywhere}
.demo-foot{font-size:17px;color:#426352}
.data-rows{margin:22px 0;display:grid;gap:20px}
.data-row{display:grid;grid-template-columns:67px 1fr 120px;gap:10px;align-items:center;font-size:23px}
.data-track{height:23px;border-radius:13px;background:#e6e7d9;overflow:hidden}
.data-bar{height:100%;border-radius:13px;background:#436e54;transform-origin:0 50%}
.data-row:last-child .data-bar{background:#b8452b}
#stage:not(.wide) .demo{left:62px;right:62px;top:384px;padding:19px}
${workflowCss}
${storyCss}
.wide.editorial{background:radial-gradient(ellipse at 80% 6%,#4a385e 0%,#282238 52%,#1b1827 94%);color:#f8f1ff}
.editorial .margin{border-color:#554665}
.editorial .text{top:154px;font-size:62px;line-height:1.13}
.editorial .text.for-demo{width:335px;line-height:1.1;font-size:56px;color:#f7efff}
.editorial .text::before{background:#cdaaff;height:4px}
.editorial .demo{background:#fcf9ff;color:#272033;border-color:#e4d9f0;top:96px;right:76px;border-radius:20px;padding:30px}
.editorial .demo-bar,.editorial .demo-foot{color:#614e75;border-color:#e7ddef}
.editorial .demo-field{background:#f6f1fb;border-color:#e2d8ec;color:#292039}
.editorial .demo-field b{color:#684c87}
.editorial .demo-field.focus{border-color:#ae90d5;background:#f0e6ff;box-shadow:inset 4px 0 #8559c9}
.editorial .sweep{background:#2a223a}
.editorial .data-track{background:#eee4f7}.editorial .data-bar{background:#b8a5ce}.editorial .data-row:last-child .data-bar{background:#744db7}
</style></head><body>
<main id="xiaopeng" data-composition-id="xiaopeng" data-start="0" data-duration="${seconds(total)}" data-width="${width}" data-height="${height}">
<div id="stage" class="${wide?'wide':''}${look==='editorial'?' editorial':''}"><div class="margin"></div>${layers}</div>
</main>
<script>
const tl=gsap.timeline({paused:true});
${timings}
window.__timelines=window.__timelines||{};
window.__timelines.xiaopeng=tl;
tl.seek(0);
</script></body></html>\n`;
}

async function renderGroup(scenes,materials,dir,size,gsap){
  const started=performance.now();
  await mkdir(path.join(dir,'assets'),{recursive:true});
  await copyFile(gsap,path.join(dir,'assets','gsap.min.js'));
  const staged=[];
  const overlays=new Map();
  let motionMs=0;
  let offset=0;
  for(const [index,scene] of scenes.entries()){
    const media=scene.material===undefined?undefined:await stageMedia(materials.get(scene.material),scene,dir,index,size.width>size.height);
    const motionStart=performance.now();
    const motionMedia=scene.motion?await motionClip(scene,dir,index):undefined;
    if(scene.workflow) overlays.set(index,await workflowOverlay(scene,dir,index));
    motionMs+=performance.now()-motionStart;
    const length=baseFrames(scene,FPS);
    staged.push({...scene,from:offset,length,displayLength:scene.length,media,motionMedia});
    offset+=length;
  }
  await writeFile(path.join(dir,'index.html'),buildHtml(staged,size));
  const {bin,args}=hyperframesRuntime();
  const runHyper=(...command)=>run(bin,[...args,...command]);
  const picture=path.join(dir,'picture.mp4');
  const checksStart=performance.now();
  // First-article checks are done once per batch. Rendering still enforces strict static lint.
  if(process.env.XIAOPENG_LAYOUT_INSPECT==='1') runHyper('inspect',dir,'--samples','8');
  const renderStart=performance.now();
  runHyper('render',dir,'--output',picture,'--fps',String(FPS),'--workers',
    process.env.XIAOPENG_HYPERFRAMES_WORKERS??'2','--quality','standard','--strict');
  const secondsSince=ms=>+(ms/1000).toFixed(2);
  return {picture,overlays,baseFrames:offset,timing:{remotionSeconds:secondsSince(motionMs),
    stageSeconds:secondsSince(checksStart-started-motionMs),
    hyperframesChecksSeconds:secondsSince(renderStart-checksStart),
    hyperframesRenderSeconds:secondsSince(performance.now()-renderStart)}};
}

export async function renderScenes(timeline,materials,dir){
  const started=performance.now();
  configureBrowser();
  const size={width:timeline.width??WIDTH,height:timeline.height??HEIGHT,look:timeline.look};
  const gsap=await stageGsap(dir);
  const cache=path.resolve(process.env.XIAOPENG_SHOT_CACHE??path.join(dir,'shot-cache'));
  const signature=await Promise.all([fileKey(fileURLToPath(import.meta.url)),
    fileKey(path.join(installedHere,'motion.tsx')),fileKey(path.join(installedHere,'workflow-view.mjs')),fileKey(gsap)]);
  signature.push(process.env.XIAOPENG_RENDER_PROFILE??'',process.env.XIAOPENG_HYPERFRAMES_BIN??'',
    process.env.XIAOPENG_CHROME??'',process.env.HYPERFRAMES_BROWSER_PATH??'',process.env.XIAOPENG_RENDER_RUNTIME??'');
  const assetKeys=new Map();
  const shots=[];
  for(const [index,scene] of timeline.scenes.entries()){
    const sweep=!scene.workflow&&!scene.story&&index>0&&(!scene.demo||timeline.scenes[index-1].demo?.id!==scene.demo.id);
    const asset=materials.get(scene.material);
    if(asset&&!assetKeys.has(asset.file)) assetKeys.set(asset.file,await fileKey(asset.file));
    const key=cacheKey([signature,size,scene.length,scene.title??scene.text,sweep,scene.demo,scene.compare,scene.data,
      scene.motion,scene.workflow,scene.story,scene.cues,scene.trim??0,asset?.file&&path.extname(asset.file),asset&&assetKeys.get(asset.file)]);
    shots.push({...scene,sweep,file:path.join(cache,key+'.mp4')});
  }
  let reused=0,rendered=0,capturedFrames=0;
  const timing={remotionSeconds:0,stageSeconds:0,hyperframesChecksSeconds:0,hyperframesRenderSeconds:0};
  for(let i=0;i<shots.length;){
    if(existsSync(shots[i].file)){reused++;i++;continue;}
    let end=i+1;
    while(end<shots.length&&!existsSync(shots[end].file)) end++;
    const group=shots.slice(i,end);
    const result=await renderGroup(group,materials,path.join(dir,`group-${i}-${end}`),size,gsap);
    for(const key of Object.keys(timing)) timing[key]+=result.timing[key];
    capturedFrames+=result.baseFrames;
    let offset=0;
    for(const [index,shot] of group.entries()){
      const start=offset;
      const captureLength=baseFrames(shot,FPS);
      offset+=captureLength;
      const overlay=result.overlays.get(index);
      const held=captureLength<shot.length;
      const freeze=held?`trim=start_frame=${start}:end_frame=${start+captureLength},`+
        `loop=loop=${shot.length-captureLength}:size=1:start=${captureLength-1},settb=1/${FPS},setpts=N,fps=${FPS}`:'null';
      const video=overlay?['-i',overlay,'-filter_complex_threads','2','-filter_complex',
        `[0:v]${freeze}[base];[1:v]scale=${size.width}:${size.height},format=yuva420p[fx];[base][fx]overlay=0:0:format=yuv420:eof_action=repeat[v]`,
        '-map','[v]']:['-map','0:v:0',...(held?['-vf',freeze]:[])];
      await writeCached(shot.file,temp=>{
        run('ffmpeg',['-nostdin','-v','error','-y',...(held?[]:['-ss',seconds(start)]),
          '-i',result.picture,...video,'-an','-frames:v',String(shot.length),
          '-c:v','libx264','-crf','18','-preset','fast','-pix_fmt','yuv420p',temp]);
        if(held){
          const count=run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=nb_frames',
            '-of','csv=p=0',temp],true,true);
          assert.equal(Number(count.trim()),shot.length,'Static hold did not preserve the shot frame count');
        }
      });
    }
    rendered+=group.length;
    i=end;
  }
  const assembly=path.join(dir,'assembly');
  await mkdir(assembly,{recursive:true});
  const names=[];
  for(const [i,shot] of shots.entries()){
    const name=`${i}.mp4`;
    await copyFile(shot.file,path.join(assembly,name));
    names.push(`file '${name}'\nduration ${seconds(shot.length)}`);
  }
  const list=path.join(assembly,'shots.txt');
  await writeFile(list,names.join('\n')+'\n');
  const picture=path.join(dir,'picture.mp4');
  run('ffmpeg',['-nostdin','-v','error','-y','-f','concat','-safe','1','-i',list,'-c','copy',picture]);
  const elapsed=(performance.now()-started)/1000;
  timing.shotCacheAndAssemblySeconds=+(elapsed-Object.values(timing).reduce((sum,s)=>sum+s,0)).toFixed(2);
  return {picture,timing,shots:{rendered,reused,capturedFrames}};
}

/** Xiaopeng AutoCut: one entry point for three video input types. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {run} from './mux.mjs';
import {canvas,captionRequest,editorialNotes,scriptInput,voicedTimeline} from './video-plan.mjs';
import {captions,narration} from './video-services.mjs';
import {mediaDuration,renderScenes} from './video-scenes.mjs';
import {audioPlan,mixVideoAudio} from './video-audio.mjs';
import {cacheKey,fileKey,writeCached} from './video-cache.mjs';

const [mode,jobFile,destination,flag,...extra]=process.argv.slice(2);
assert(['talk','script','montage'].includes(mode)&&jobFile&&destination&&!extra.length&&
  (!flag||['--preview','--voice-sample'].includes(flag)),
  'Usage: node create-video.mjs talk|script|montage JOB.json OUT [--preview|--voice-sample]');
const preview=flag==='--preview';
const jobRoot=path.dirname(path.resolve(jobFile));
const job=JSON.parse(await readFile(jobFile,'utf8'));
const out=path.resolve(destination);
const resolve=file=>path.resolve(jobRoot,file);
if(flag==='--voice-sample'){
  assert(mode!=='talk','Talk mode uses the original recorded voice');
  assert(typeof job.sampleText==='string'&&job.sampleText.trim()&&job.sampleText.length<=130,
    'Set sampleText to a short excerpt (at most 130 characters)');
  await mkdir(out,{recursive:true,mode:0o700});
  const sample=await narration(job,job.sampleText,out,false);
  console.log(JSON.stringify({audio:sample.audio,provider:sample.provider,seconds:mediaDuration(sample.audio,'a:0')}));
  process.exit(0);
}
job.captionsAss=job.captionsAss&&resolve(job.captionsAss);
for(const key of ['materials','sceneAssets']){
  if(Array.isArray(job[key])) job[key]=job[key].map(material=>({...material,file:resolve(material.file)}));
}
if(job.previewVoice) job.previewVoice={audio:resolve(job.previewVoice.audio),alignment:resolve(job.previewVoice.alignment),provider:job.previewVoice.provider};
const sound=job.audio??{};
const batchMusic=mode!=='talk'&&process.env.XIAOPENG_BATCH_MUSIC?JSON.parse(process.env.XIAOPENG_BATCH_MUSIC):undefined;
if(sound.music===undefined&&batchMusic) sound.music=batchMusic;
if(sound.music) sound.music={...sound.music,file:resolve(sound.music.file)};
if(Array.isArray(sound.effects)) sound.effects=sound.effects.map(effect=>({...effect,file:resolve(effect.file)}));
if(!preview&&!job.captionsAss&&!process.env.XIAOPENG_CAPTIONS_BIN){
  // Avoid charging for speech before the downstream caption provider is available.
  throw new Error('Captions AI is not connected. Configure XIAOPENG_CAPTIONS_BIN or import ASS.');
}

const started=performance.now();
await mkdir(out,{recursive:true,mode:0o700});
const pictureOnly=path.join(out,'talk-picture.mp4');
let picture,audio,voiceProvider,timeline;
let shots;
const timing={};
const elapsedSince=start=>+((performance.now()-start)/1000).toFixed(2);
if(mode==='talk'){
  assert(job.format===undefined||job.format==='9:16','Landscape is available in script and montage modes');
  assert(typeof job.project==='string'&&job.project.trim(),'Talk mode needs a prepared local project');
  const project=resolve(job.project);
  timeline=JSON.parse(await readFile(path.join(project,'timeline.json'),'utf8'));
  audio=path.join(project,'public','voice.wav');
  voiceProvider='original talking-head voice';
} else {
  const input=scriptInput(mode,job);
  const spoken=await narration(job,input.text,out,preview);
  audio=spoken.audio;
  voiceProvider=spoken.provider;
  timing.narrationSeconds=elapsedSince(started);
  const timelineStart=performance.now();
  timeline={...voicedTimeline(input,spoken.alignment,mediaDuration(audio,'a:0')),...canvas(job.format,preview),
    look:job.look};
  timing.timelineSeconds=elapsedSince(timelineStart);
  await writeFile(path.join(out,'timeline.json'),JSON.stringify(timeline,null,2)+'\n');
  timeline.materials=input.materials;
}

timing.narrationAndTimelineSeconds=elapsedSince(started);
const request=captionRequest(mode,timeline);
const mix=audioPlan(sound,timeline);
const captionStart=performance.now();
const subtitle=await captions(job,request,audio,out,preview);
timing.captionSeconds=elapsedSince(captionStart);
if(mode==='talk'){
  const previous=process.env.XIAOPENG_EXTERNAL_CAPTIONS;
  process.env.XIAOPENG_EXTERNAL_CAPTIONS='1';
  try {
    run(process.execPath,['export.mjs',pictureOnly],false,false,resolve(job.project));
  } finally {
    if(previous===undefined) delete process.env.XIAOPENG_EXTERNAL_CAPTIONS;
    else process.env.XIAOPENG_EXTERNAL_CAPTIONS=previous;
  }
  picture=pictureOnly;
} else {
  const rendered=await renderScenes(timeline,timeline.materials,path.join(out,'hyperframes'));
  picture=rendered.picture;
  shots=rendered.shots;
  Object.assign(timing,rendered.timing);
}

const muxStart=performance.now();
const mixStart=performance.now();
const pending=path.join(out,'video.pending.mp4');
const result=path.join(out,preview?'preview.mp4':'video.mp4');
if(mode==='talk') audio=picture;
const duration=String(timeline.frames/timeline.fps);
const sourceKey=await fileKey(audio);
const musicKey=mix.music&&[mix.music.gain,await fileKey(mix.music.file)];
const effectKeys=await Promise.all(mix.effects.map(async effect=>[effect.frame,effect.gain,await fileKey(effect.file)]));
const audioKey=cacheKey([await fileKey(new URL('./video-audio.mjs',import.meta.url)),sourceKey,duration,musicKey,effectKeys]);
const audioTrack=path.join(out,'audio-cache',audioKey+'.m4a');
const reusedAudioTrack=existsSync(audioTrack);
if(!reusedAudioTrack){
  if(mix.music||mix.effects.length){
    const mixed=path.join(out,'mixed.wav');
    mixVideoAudio(audio,mix,timeline,mixed);
    audio=mixed;
  }
  await writeCached(audioTrack,temp=>run('ffmpeg',['-nostdin','-v','error','-y','-i',audio,
    '-map','0:a:0','-af','apad','-t',duration,'-c:a','aac','-b:a','192k',temp]));
}
timing.audioMixSeconds=elapsedSince(mixStart);
const subtitleRenderStart=performance.now();
const captionedKey=cacheKey(['h264-fast-1',await fileKey(picture),await fileKey(subtitle.file)]);
const captioned=path.join(out,'captioned',captionedKey+'.mp4');
const reusedCaptionedPicture=existsSync(captioned);
if(!reusedCaptionedPicture){
  await writeCached(captioned,temp=>run('ffmpeg',['-nostdin','-v','error','-y','-i',picture,'-map','0:v:0','-an',
    '-vf','subtitles=filename=captions.ass','-c:v','libx264','-pix_fmt','yuv420p','-preset','fast',temp],false,false,out));
}
timing.subtitleBurnSeconds=elapsedSince(subtitleRenderStart);
const exportStart=performance.now();
run('ffmpeg',['-nostdin','-v','error','-y','-i',captioned,'-i',audioTrack,'-map','0:v:0','-map','1:a:0',
  '-t',duration,'-c','copy','-movflags','+faststart',pending]);
timing.exportSeconds=elapsedSince(exportStart);
const verifyStart=performance.now();
const probe=JSON.parse(run('ffprobe',['-v','error','-show_entries',
  'stream=codec_type,width,height,nb_frames,duration','-of','json',pending],true,true));
const video=probe.streams.find(stream=>stream.codec_type==='video');
const voice=probe.streams.find(stream=>stream.codec_type==='audio');
assert(video&&voice&&Number(video.nb_frames)===timeline.frames&&
  video.width===request.width&&video.height===request.height&&
  Math.abs(Number(video.duration)-Number(voice.duration))<=1/timeline.fps,'Output audio/video timing or format differs from the timeline');
run('ffmpeg',['-nostdin','-v','error','-xerror','-i',pending,'-f','null','-']);
await rename(pending,result);
timing.decodeCheckSeconds=elapsedSince(verifyStart);
const report={mode,preview,voice:voiceProvider,captions:subtitle.provider,
  picture:mode==='talk'?'Remotion':'HyperFrames',motion:!!timeline.scenes?.some(scene=>scene.motion||scene.workflow),
  width:request.width,height:request.height,shots,reusedCaptionedPicture,reusedAudioTrack,
  editorialNotes:editorialNotes(timeline.scenes),
  audio:{music:mix.music?.id??(mix.music?path.basename(mix.music.file):null),
    effects:mix.effects.map(effect=>({frame:effect.frame,file:path.basename(effect.file)}))},
  fps:timeline.fps,frames:timeline.frames,seconds:elapsedSince(started),
  timing:{...timing,muxAndDecodeSeconds:elapsedSince(muxStart)}};
await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({result,...report},null,2));

import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,rename,rm,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {captionStates} from './caption-states.mjs';
import {configureBrowser,prepareCaptionBundle,remotionRuntime} from './render-runtime.mjs';

const seconds=()=>performance.now()/1000;
const round=value=>+value.toFixed(3);
const [pagesFile,framesValue,pictureFile,audioFile,outputFile,reportFile]=process.argv.slice(2);

async function overlay(pages,frames,picture,audio,output){
  const start=seconds();
  const {states,runs}=captionStates(pages,frames);
  const planned=seconds();
  const {modules}=remotionRuntime();
  const require=createRequire(path.join(modules,'@remotion','cli','package.json'));
  const {openBrowser,renderFrames,selectComposition}=require('@remotion/renderer');
  const {bundle:serveUrl,bundleHit}=await prepareCaptionBundle();
  const bundled=seconds();
  const browserExecutable=process.env.XIAOPENG_CHROME||configureBrowser();
  const browser=await openBrowser('chrome',{browserExecutable});
  const images=new Map();
  let selected,renderStarted,captured;
  try{
    const inputProps={states};
    const composition=await selectComposition({serveUrl,id:'CaptionOverlay',inputProps,puppeteerInstance:browser});
    selected=seconds();
    await renderFrames({serveUrl,composition,inputProps,puppeteerInstance:browser,imageFormat:'png',
      outputDir:null,muted:true,concurrency:2,onStart(){renderStarted=seconds();},
      onFrameUpdate(){},onFrameBuffer(buffer,frame){images.set(frame,buffer);}});
    captured=seconds();
  } finally {
    await browser.close({silent:true});
  }
  assert.equal(images.size,states.length,'A caption state was not captured');
  const encoding=seconds();
  const temporary=path.join(path.dirname(output),`.${path.basename(output)}.${randomUUID()}.mp4`);
  try {
    const ffmpeg=spawn('ffmpeg',['-nostdin','-v','error','-i',picture,
      '-f','image2pipe','-framerate','30','-c:v','png','-i','pipe:0','-i',audio,
      '-filter_complex_threads','2','-filter_complex','[0:v][1:v]overlay=0:562:shortest=1[v]',
      '-map','[v]','-map','2:a:0','-frames:v',String(frames),'-c:v','libx264','-preset','fast',
      '-crf','17','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',temporary],
    {stdio:['pipe','ignore','inherit']});
    const exited=new Promise((resolve,reject)=>{
      ffmpeg.once('error',reject);
      ffmpeg.once('close',code=>code===0?resolve():reject(new Error(`FFmpeg exit ${code}`)));
    });
    function* imageStream(){
      for(const {id,count} of runs){
        for(let i=0;i<count;i++) yield images.get(id);
      }
    }
    await Promise.all([pipeline(imageStream(),ffmpeg.stdin),exited]);
    await rename(temporary,output);
  } finally {
    await rm(temporary,{force:true});
  }
  const done=seconds();
  return {frames,stateCount:states.length,runCount:runs.length,bundleHit,
    planSeconds:round(planned-start),bundleSeconds:round(bundled-planned),
    startAndCompositionSeconds:round(selected-bundled),rendererPrepSeconds:round(renderStarted-selected),
    screenshotSeconds:round(captured-renderStarted),browserCloseSeconds:round(encoding-captured),
    compositeSeconds:round(done-encoding),totalSeconds:round(done-start)};
}

if(pagesFile==='--warmup'){
  const start=seconds();
  console.log(JSON.stringify({...await prepareCaptionBundle(),seconds:round(seconds()-start)}));
} else {
  assert(reportFile,'Usage: caption-overlay.mjs pages.json frame-count clean-720p30.mp4 mixed.wav output.mp4 report.json');
  const pages=JSON.parse(await readFile(pagesFile,'utf8'));
  const report=await overlay(pages,Number(framesValue),pictureFile,audioFile,outputFile);
  await writeFile(reportFile,JSON.stringify(report,null,2));
}

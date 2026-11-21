/** Assemble, level and verify audio without encoding the rendered picture twice. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync, unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {KEYWORD_DUCK,adaptiveSoundGain,ducksVoice,soundEvents} from './sound-plan.mjs';

export function run(command, args, capture=false, stdout=false, cwd) {
  const result=spawnSync(command,args,{...(capture?{encoding:'utf8'}:{stdio:'inherit'}),cwd});
  if(result.error) throw result.error;
  if(result.status!==0) throw Error(command+' failed: '+(result.stderr||'').slice(-2000));
  return stdout?result.stdout:result.stderr;
}

const meterRate=8000;

function pcm(file,seconds) {
  const length=seconds===undefined?[]:['-t',String(seconds)];
  const result=spawnSync('ffmpeg',['-nostdin','-v','error','-i',file,...length,'-ac','2',
    '-ar',String(meterRate),'-f','f32le','pipe:1'],{maxBuffer:128*1024*1024});
  if(result.error) throw result.error;
  assert.equal(result.status,0,result.stderr?.toString());
  return result.stdout;
}

function rms(pcmBytes,start=0,seconds=.12){
  const sampleBytes=8;
  const end=Math.min(start+Math.round(seconds*meterRate)*sampleBytes,pcmBytes.length);
  let sum=0;
  let count=0;
  for(let cursor=start;cursor<end;cursor+=4){
    sum+=pcmBytes.readFloatLE(cursor)**2;
    count++;
  }
  return count ? Math.sqrt(sum/count) : 0;
}

export function measureAudioGains(timeline,rough=false){
  const events=soundEvents(timeline,rough).filter(e=>e.kind==='semantic');
  if(!events.length) return {};
  const voice=pcm('public/voice.wav');
  const effects=new Map();
  return Object.fromEntries(events.map(({from,file})=>{
    if(!effects.has(file)) effects.set(file,rms(pcm(path.join('public',file),.12)));
    const offset=Math.round(from*meterRate/timeline.fps)*8;
    return [from,adaptiveSoundGain(rms(voice,offset),effects.get(file))];
  }));
}

export function mux(timeline,picture,destination,rough=false,range) {
  const sounds=soundEvents(timeline,rough);
  assert.equal(48000%timeline.fps,0,'Frame rate must divide the sample rate');
  const samples=48000/timeline.fps;
  const inputs=sounds.flatMap(cue=>['-i',path.join('public',cue.file)]);
  const effects=sounds.map((cue,i)=>
    '['+(i+1)+':a]aresample=48000,volume='+cue.gain+',adelay='+cue.from*samples+'S:all=1[fx'+i+']');
  const {attack,hold,release,depth}=KEYWORD_DUCK;
  const windows=sounds.filter(ducksVoice).map(c=>{
    const start=c.from*samples;
    const end=start+Math.round((attack+hold+release)*48000);
    return 'clip(min((n-'+start+')/'+Math.round(attack*48000)+',('+end+'-n)/'+Math.round(release*48000)+'),0,1)';
  });
  const envelope=windows.reduce((a,w)=>a?'max('+a+','+w+')':w,'');
  if(envelope){
    const gain='(1-'+depth+'*'+envelope+')';
    effects.push("[0:a]aformat=sample_rates=48000:channel_layouts=stereo,aeval='val(0)*"+gain+"|val(1)*"+gain+"':c=stereo[voice]");
  }
  const sound=(envelope?'[voice]':'[0:a]')+sounds.map((_,i)=>'[fx'+i+']').join('')+
    'amix=inputs='+(sounds.length+1)+':duration=first:normalize=0[a]';
  const mix=path.join(tmpdir(),'autocut-'+randomUUID()+'.wav');
  const common=['-nostdin','-hide_banner','-y'];
  try {
    run('ffmpeg',[...common,'-v','error','-i','public/voice.wav',...inputs,
      '-filter_complex',[...effects,sound].join(';'),'-map','[a]','-c:a','pcm_f32le',mix]);
    const meter=run('ffmpeg',[...common,'-i',mix,'-af','loudnorm=print_format=json','-f','null','-'],true);
    const {input_i,input_tp}=JSON.parse(meter.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0]||'{}');
    const gain=Math.min(-16-Number(input_i),-2-Number(input_tp));
    assert(Number.isFinite(gain),'The audio meter did not find speech');
    const trim=range?`,atrim=start_sample=${range.start*samples}:end_sample=${range.end*samples},asetpts=PTS-STARTPTS`:'';
    run('ffmpeg',[...common,'-v','error','-i',picture,'-i',mix,'-map','0:v:0','-map','1:a:0',
      '-c:v','copy','-af','volume='+gain.toFixed(2)+'dB'+trim,'-c:a','aac','-b:a','192k','-movflags','+faststart',destination]);
    run('ffmpeg',['-nostdin','-v','error','-xerror','-i',destination,'-f','null','-']);
  } finally {
    try {unlinkSync(mix);} catch(error) {if(error.code!=='ENOENT') throw error;}
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [, ,picture,destination,mode]=process.argv;
  assert(picture&&destination,'Pass a previously rendered picture and output file');
  const timeline=JSON.parse(readFileSync('timeline.json','utf8'));
  const rough=mode==='rough';
  mux({...timeline,audioGains:measureAudioGains(timeline,rough)},picture,destination,rough);
}

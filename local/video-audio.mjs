import assert from 'node:assert/strict';
import {run} from './mux.mjs';

function gain(value,fallback,max){
  const selected=value??fallback;
  assert(Number.isFinite(selected)&&selected>0&&selected<=max,'Invalid audio gain');
  return selected;
}

export function audioPlan(settings,timeline){
  assert(settings.effects===undefined||Array.isArray(settings.effects),'effects must be an array');
  const music=settings.music?{...settings.music,gain:gain(settings.music.gain,.14,.30)}:undefined;
  const seen=new Set();
  const effects=(settings.effects??[]).map(effect=>{
    let frame=effect.frame;
    if(frame===undefined){
      assert(Number.isInteger(effect.scene)&&effect.scene>0,'An effect needs a frame or scene number');
      const scene=timeline.scenes?.[effect.scene-1];
      assert(scene,'Effect scene does not exist');
      const offset=effect.offsetFrames??0;
      assert(Number.isInteger(offset)&&offset>=0,'Invalid effect offset');
      frame=scene.from;
      if(effect.anchor!==undefined){
        assert(typeof effect.anchor==='string'&&effect.anchor.trim(),'Invalid effect anchor');
        const pattern=Array.from(effect.anchor.normalize('NFC').replace(/\s+/gu,''));
        const index=scene.tokens.findIndex((_,i)=>pattern.every((char,j)=>char===scene.tokens[i+j]?.text));
        assert(index>=0,'Effect anchor is not in its scene');
        frame=scene.tokens[index].from;
      }
      frame+=offset;
      assert(frame<scene.from+scene.length,'Effect offset exceeds its scene');
    }
    assert(Number.isInteger(frame)&&frame>=0&&frame<timeline.frames,'Effect frame is outside the timeline');
    assert(!seen.has(frame),'Use one focal sound effect at a frame');
    seen.add(frame);
    return {...effect,frame,gain:gain(effect.gain,.45,1.8)};
  });
  return {music,effects};
}

export function mixVideoAudio(source,plan,timeline,out){
  assert(48000%timeline.fps===0,'Frame rate must divide the audio sample rate');
  const samples=48000/timeline.fps;
  const seconds=timeline.frames/timeline.fps;
  const fade=Math.min(.6,seconds/4);
  const args=['-nostdin','-v','error','-y','-i',source];
  const shape='aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  const filters=[`[0:a]${shape},apad,atrim=end_sample=${samples*timeline.frames}[narration]`];
  const streams=[];
  if(plan.music){
    args.push('-stream_loop','-1','-i',plan.music.file);
    filters.push('[narration]asplit=2[voice][control]');
    filters.push(`[1:a]${shape},atrim=duration=${seconds},volume=${plan.music.gain},afade=t=in:d=${fade},afade=t=out:st=${seconds-fade}:d=${fade}[bed]`);
    filters.push('[bed][control]sidechaincompress=threshold=0.045:ratio=6:attack=12:release=340[bgm]');
    streams.push('[voice]','[bgm]');
  } else streams.push('[narration]');
  for(const [index,effect] of plan.effects.entries()){
    const input=index+(plan.music?2:1);
    args.push('-i',effect.file);
    filters.push(`[${input}:a]${shape},atrim=duration=0.8,volume=${effect.gain},adelay=${effect.frame*samples}S:all=1[fx${index}]`);
    streams.push(`[fx${index}]`);
  }
  filters.push(`${streams.join('')}amix=inputs=${streams.length}:duration=first:normalize=0,alimiter=limit=0.90:level=0:latency=1[a]`);
  run('ffmpeg',[...args,'-filter_complex',filters.join(';'),'-map','[a]','-c:a','pcm_s16le',out]);
}

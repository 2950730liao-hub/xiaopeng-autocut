import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {run} from './mux.mjs';

export async function narration(job,text,out,preview){
  const audio=path.join(out,'narration.wav');
  if(job.previewVoice){
    assert(preview,'A preview voice is only available in preview mode');
    const alignment=JSON.parse(await readFile(job.previewVoice.alignment,'utf8'));
    run('ffmpeg',['-nostdin','-v','error','-y','-i',job.previewVoice.audio,'-ar','48000','-ac','2',audio]);
    return {audio,alignment,provider:job.previewVoice.provider?`imported preview voice (${job.previewVoice.provider})`:'preview fixture'};
  }
  assert(typeof job.voiceId==='string'&&/^[A-Za-z0-9_-]+$/.test(job.voiceId),'Supply an ElevenLabs voiceId');
  const options={text,model_id:job.voiceModel??'eleven_multilingual_v2'};
  const hash=createHash('sha256').update(JSON.stringify([job.voiceId,options])).digest('hex');
  const cache=process.env.XIAOPENG_VOICE_CACHE??out;
  await mkdir(cache,{recursive:true,mode:0o700});
  const receipt=path.join(cache,`elevenlabs-${hash}.json`);
  let response;
  try {
    response=JSON.parse(await readFile(receipt,'utf8'));
  } catch(error){
    if(error.code!=='ENOENT') throw error;
    const key=process.env.ELEVENLABS_API_KEY;
    assert(key,'Set ELEVENLABS_API_KEY to generate an ElevenLabs voice');
    const result=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${job.voiceId}/with-timestamps?output_format=mp3_44100_128`,{
      method:'POST',headers:{'xi-api-key':key,'Content-Type':'application/json'},body:JSON.stringify(options),
      signal:AbortSignal.timeout(120_000),
    });
    assert(result.ok,`ElevenLabs narration request failed (HTTP ${result.status})`);
    response=await result.json();
    assert(response.audio_base64&&response.alignment,'ElevenLabs did not return audio and alignment');
    const pending=receipt+'.'+process.pid+'.tmp';
    await writeFile(pending,JSON.stringify(response),{mode:0o600});
    await rename(pending,receipt);
  }
  assert(response.audio_base64&&response.alignment,'Invalid ElevenLabs cache entry');
  const mp3=path.join(out,'narration-source.mp3');
  await writeFile(mp3,Buffer.from(response.audio_base64,'base64'),{mode:0o600});
  run('ffmpeg',['-nostdin','-v','error','-y','-i',mp3,'-ar','48000','-ac','2',audio]);
  return {audio,alignment:response.alignment,provider:'ElevenLabs'};
}

function assTime(frame,fps){
  const cs=Math.round(100*frame/fps);
  return `${Math.floor(cs/360000)}:${String(Math.floor(cs/6000)%60).padStart(2,'0')}:${String(Math.floor(cs/100)%60).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`;
}

const assPlain=text=>text.replace(/[{}\\]/g,char=>({'{':'｛','}':'｝','\\':'＼'})[char]).replace(/[\r\n]/g,' ');

function captionGroups(row){
  if(!row.tokens) return [{from:row.from,to:row.from+row.length,text:row.text,highlights:row.highlights}];
  const segments=new Intl.Segmenter('zh-CN',{granularity:'word'}).segment(row.text.normalize('NFC'));
  const groups=[];
  let current=[], width=0, cursor=0;
  for(const {segment} of segments){
    const chars=Array.from(segment);
    const spaces=/^\s+$/u.test(segment);
    const punctuation=/^\p{P}$/u.test(segment);
    const weight=spaces ? .35 : chars.reduce((sum,char)=>sum+(/[A-Za-z0-9]/.test(char) ? .56 : 1),0);
    if(current.length&&!spaces&&!punctuation&&width+weight>15){
      groups.push(current);
      current=[];
      width=0;
    }
    if(!spaces||current.length){
      current.push({segment,cursor,weight,spaces});
      width+=weight;
    }
    if(!spaces) cursor+=chars.length;
    if(width>=8&&/[，。！？；,.!?]$/u.test(segment)){
      groups.push(current);
      current=[];
      width=0;
    }
  }
  if(current.length) groups.push(current);
  const groupText=group=>group.map(item=>item.segment).join('').trim();
  const groupWidth=group=>group.reduce((sum,item)=>sum+item.weight,0);
  for(const [index,group] of groups.entries()){
    const previous=groups[index-1];
    if(!previous||groupWidth(group)>=5||/[，。！？；,.!?]$/u.test(groupText(previous))) continue;
    while(groupWidth(group)<5&&groupWidth(previous)>8&&previous.filter(item=>!item.spaces).length>1){
      group.unshift(previous.pop());
    }
  }
  const groupStart=group=>row.tokens[group.find(item=>!item.spaces).cursor].from;
  return groups.flatMap((group,index)=>{
    const from=index?groupStart(group):row.from;
    const next=groups[index+1];
    const to=next?groupStart(next):row.from+row.length;
    return to>from?[{from,to,text:groupText(group),highlights:row.highlights}]:[];
  });
}

export function previewAss({width,height,fps,spoken}){
  const wide=width>height;
  const font=wide?Math.round(height*.046):37;
  const bottom=wide?Math.round(height*.085):120;
  const header=`[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,PingFang SC,${font},&H00FFF9ED,&H00FFF9ED,&H002A2820,&H002A2820,-1,0,0,0,100,100,0,0,1,3,1,2,48,48,${bottom},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  return header+spoken.flatMap(captionGroups).map(({from,to,text,highlights})=>{
    let line=assPlain(text);
    const emphasis=highlights?.find(item=>item.from<to&&from<item.from+item.length&&line.includes(assPlain(item.term)));
    if(emphasis) line=line.replace(assPlain(emphasis.term),match=>'{\\c&H006FCFFF&}'+match+'{\\r}');
    return `Dialogue: 0,${assTime(from,fps)},${assTime(to,fps)},Default,,0,0,0,,${line}`;
  }).join('\n')+'\n';
}

export async function captions(job,request,audio,out,preview){
  const file=path.join(out,'captions.ass');
  const requestPath=path.join(out,'caption-request.json');
  await writeFile(requestPath,JSON.stringify(request,null,2)+'\n');
  let provider='Captions AI';
  if(job.captionsAss){
    if(path.resolve(job.captionsAss)!==file) await copyFile(job.captionsAss,file);
    provider='imported ASS (provider not verified)';
  } else if(process.env.XIAOPENG_CAPTIONS_BIN){
    const pending=path.join(out,'captions-adapter.ass');
    await rm(pending,{force:true});
    run(process.env.XIAOPENG_CAPTIONS_BIN,['--request',requestPath,'--audio',audio,'--output',pending]);
    await rename(pending,file);
    provider='configured Captions AI adapter';
  } else {
    assert(preview,'Captions AI is not connected. Configure XIAOPENG_CAPTIONS_BIN or import ASS.');
    await writeFile(file,previewAss(request));
    provider='local preview captions';
  }
  const contents=await readFile(file,'utf8');
  assert(/^\[Events\]/m.test(contents)&&/^Dialogue:/m.test(contents),'Expected an ASS subtitle track with dialogue');
  return {file,provider};
}

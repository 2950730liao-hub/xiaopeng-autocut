/** Picture and audio use the same output frame for each cue. */
export function soundEvents({cues,emphasis=[],audioGains={}},rough=false) {
  if(rough) return [];
  const events=new Map();
  for(const cue of cues.filter(item=>item.sound))
    events.set(cue.from,cue.visual&&cue.soundFile
      ? {from:cue.from,file:cue.soundFile,gain:audioGains[cue.from]??.55,text:cue.text,kind:'semantic'}
      : {from:cue.from,file:'tap.wav',gain:.55,text:cue.text,kind:'cue'});
  for(const item of emphasis){
    const large=item.mode==='large';
    events.set(item.from,{from:item.from,file:large?'keyword-pop.wav':'keyword-tick.wav',
      gain:large ? .98 : .95,text:item.term,kind:'keyword'});
  }
  return Array.from(events.values()).sort((a,b)=>a.from-b.from);
}

export const KEYWORD_DUCK={attack:.006,hold:.058,release:.055,depth:.34};
export const ducksVoice=event=>event.kind==='keyword'||event.kind==='semantic';

export function adaptiveSoundGain(voiceRms, effectRms) {
  if(effectRms<.0001) throw new Error('Sound effect lacks an audible onset');
  // Aim slightly below the local syllable and constrain changes in quiet or loud windows.
  const target=Math.max(.032,voiceRms * .7);
  return Math.round(Math.min(1.8,Math.max(.16,target/effectRms))*1000)/1000;
}

export function voiceGainAt(time,events,fps){
  const {attack,hold,release,depth}=KEYWORD_DUCK;
  const end=attack+hold+release;
  const envelopes=events.filter(ducksVoice).map(e=>{
    const elapsed=time-e.from/fps;
    return Math.max(0,Math.min(1,elapsed/attack,(end-elapsed)/release));
  });
  return 1-depth*Math.max(0,...envelopes);
}

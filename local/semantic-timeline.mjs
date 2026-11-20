import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

/** Apply treatments to anchors that have already been mapped from retained speech. */
export function applySemanticPlan(timeline, plan) {
  const cues=new Map(timeline.cues.map(cue=>[cue.from,cue]));
  const emphasis=new Map((timeline.emphasis??[]).map(item=>[item.from,item]));
  const assigned=new Set();
  for(const choice of plan){
    const {anchor,kind,soundFile,side='left'}=choice;
    assert(['card','action','image'].includes(kind),'Unknown semantic treatment');
    assert(['left','right'].includes(side),'Invalid placement');
    assert(soundFile===undefined||/^[\w-]+\.wav$/.test(soundFile),'Use a local WAV basename');
    const matches=anchor.word===undefined
      ? [...emphasis.values()].filter(item=>item.term===anchor.term)
      : timeline.cues.filter(cue=>cue.word===anchor.word);
    assert(matches.length===1,'Use a unique retained speech anchor');
    const base=matches[0];
    assert(!assigned.has(base.from),'Multiple semantic treatments on one frame');
    assigned.add(base.from);
    const cue=cues.get(base.from);
    const active=emphasis.get(base.from);
    const text=choice.text??cue?.text??active?.term;
    assert(typeof text==='string'&&text.trim(),'Missing treatment text');
    const {step,total}=choice;
    if(kind==='card'){
      assert(Number.isInteger(total)&&total>=2&&total<=9,'Card total must be 2–9');
      assert(Number.isInteger(step)&&step>=0&&step<=total,'Invalid card step');
    }
    if(kind==='image') assert(cue?.asset && !/\.mp4$/i.test(cue.asset),'Image treatment needs an existing still');
    const motion=kind==='action'?(choice.motion??'reveal'):undefined;
    assert(!motion||['shield','push','reveal'].includes(motion),'Unknown action motion');
    const length=choice.holdFrames??cue?.length??active?.length;
    assert(Number.isInteger(length)&&length>0&&base.from+length<=timeline.frames,'Treatment exceeds timeline');
    cues.set(base.from,{...cue,from:base.from,length,text,sound:Boolean(soundFile),soundFile,
      visual:{kind,side,step,total,motion}});
    // Display the regular subtitle while the selected treatment owns the emphasis.
    emphasis.delete(base.from);
  }
  const ordered=[...cues.values()].sort((a,b)=>a.from-b.from);
  for(const [index,cue] of ordered.entries()){
    const next=ordered[index+1];
    assert(!next||(!cue.visual&&!next.visual)||cue.from+cue.length<=next.from,'Overlapping visual treatments');
  }
  const treated=ordered.filter(cue=>cue.visual);
  const visible=[...emphasis.values()].filter(item=>!treated.some(cue=>
    item.from<cue.from+cue.length&&cue.from<item.from+item.length));
  return {...timeline,cues:ordered,emphasis:visible};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [timelinePath,planPath,output]=process.argv.slice(2);
  assert(output,'Usage: semantic-timeline.mjs TIMELINE PLAN OUTPUT');
  const load=async file=>JSON.parse(await readFile(file,'utf8'));
  const [timeline,plan]=await Promise.all([load(timelinePath),load(planPath)]);
  await writeFile(output,JSON.stringify(applySemanticPlan(timeline,plan),null,2)+'\n');
}

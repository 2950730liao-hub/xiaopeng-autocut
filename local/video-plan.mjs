import assert from 'node:assert/strict';
import {workflowCues} from './workflow-view.mjs';

export const FPS=30;
export const WIDTH=720;
export const HEIGHT=1280;

export function canvas(format,preview){
  assert(format===undefined||['9:16','16:9'].includes(format),'format must be 9:16 or 16:9');
  return format==='16:9'
    ? preview?{width:1280,height:720}:{width:1920,height:1080}
    : {width:WIDTH,height:HEIGHT};
}

export function scriptInput(mode,job){
  assert(typeof job.script==='string'&&job.script.trim(),'A narration script is required');
  const sources=mode==='montage'?job.materials:job.sceneAssets;
  assert(sources===undefined||Array.isArray(sources),'Materials must be an array');
  assert(mode==='montage'||!job.materials?.length,'Use montage mode with supplied materials');
  const materials=new Map();
  for(const material of sources??[]){
    assert(typeof material.id==='string'&&material.id&&!materials.has(material.id)&&
      typeof material.file==='string'&&material.file.trim(),'Each material needs a distinct id and file');
    materials.set(material.id,material);
  }
  assert(mode!=='montage'||materials.size>0,'Montage needs supplied materials');
  assert(job.scenes===undefined||Array.isArray(job.scenes)&&job.scenes.length,'Invalid scenes array');
  const parts=Array.isArray(job.scenes)&&job.scenes.length
    ?job.scenes
    :job.script.split(/(?<=[。！？!?])|\n+/u).map(text=>text.trim()).filter(Boolean)
      .map(text=>({text}));
  for(const scene of parts){
    assert(typeof scene.text==='string'&&scene.text.trim(),'Each scene needs spoken text');
    assert(scene.title===undefined||typeof scene.title==='string'&&scene.title.trim()&&Array.from(scene.title).length<=32,
      'Scene titles must be 1–32 characters');
    if(scene.demo){
      const {id,request,status,detail,focus}=scene.demo;
      assert([id,request,status,detail].every(value=>typeof value==='string'&&value.trim()),
        'A demo needs id, request, status and detail');
      assert(['request','evidence','approval','result'].includes(focus),'Invalid demo focus');
    }
    if(scene.workflow){
      const {workflow}=scene;
      assert(job.format==='16:9','Workflow demo requires 16:9');
      for(const key of ['id','heading','subject','request','source','result']){
        assert(typeof workflow[key]==='string'&&workflow[key].trim(),`Missing workflow field: ${key}`);
      }
      assert(Array.isArray(workflow.clauses)&&workflow.clauses.length===2&&
        workflow.clauses.every(term=>typeof term==='string'&&term.trim()&&Array.from(term).length<=13),
      'Workflow needs two compact evidence phrases (1–13 characters)');
      assert(['lookup','evidence','approve','write'].every(key=>typeof workflow.anchors?.[key]==='string'&&
        workflow.anchors[key].trim()&&scene.text.includes(workflow.anchors[key])),
      'Workflow anchors must occur in spoken scene text');
    }
    if(scene.story){
      const {layout,kicker,items}=scene.story;
      assert(job.format==='16:9'&&scene.title&&['lead','path','evidence','check'].includes(layout)&&
        typeof kicker==='string'&&kicker.trim(),'Story requires 16:9, title, layout and kicker');
      assert(Array.isArray(items)&&items.length>=2&&items.length<=3&&items.every(item=>
        typeof item.label==='string'&&item.label.trim()&&typeof item.detail==='string'&&item.detail.trim()),
      'Story needs two or three labeled fields');
    }
    const visual=[scene.demo,scene.compare,scene.data,scene.workflow,scene.story].filter(Boolean);
    assert(visual.length<=1&&(!visual.length||scene.material===undefined&&!scene.motion),
      'Use one main visual: demo, compare, data or source media');
    if(scene.compare){
      assert(['before','after','basis'].every(key=>typeof scene.compare[key]==='string'&&scene.compare[key].trim()),
        'A comparison needs before, after and basis');
    }
    if(scene.data){
      const {label,before,after,unit,detail}=scene.data;
      assert([label,unit,detail].every(value=>typeof value==='string'&&value.trim())&&
        [before,after].every(value=>Number.isFinite(value)&&value>=0)&&Math.max(before,after)>0,
      'A data card needs two comparable non-negative values, a label, unit and explanation');
    }
    assert(!scene.motion||['action','progress','number'].includes(scene.motion.kind),'Unknown motion');
    if(scene.motion){
      assert(typeof scene.motion.label==='string'&&scene.motion.label.trim(),'Motion needs a label');
      if(scene.motion.kind==='progress'){
        const {step,total}=scene.motion;
        assert(Number.isInteger(total)&&total>=2&&total<=9&&Number.isInteger(step)&&step>=1&&step<=total,
          'Progress requires a step in a series of 2–9');
      }
    }
    if(scene.material!==undefined){
      assert(materials.has(scene.material),'Unknown scene material: '+scene.material);
      assert(Number.isFinite(scene.trim??0)&&(scene.trim??0)>=0,'Invalid material trim');
    }
    assert(scene.highlights===undefined||Array.isArray(scene.highlights)&&
      scene.highlights.every(term=>typeof term==='string'&&term.trim()&&scene.text.includes(term)),
    'Scene highlights must be spoken text');
  }
  const compact=value=>value.normalize('NFC').replace(/\s+/gu,'');
  assert.equal(compact(parts.map(scene=>scene.text).join('')),compact(job.script),
    'Scene narration must match the supplied script');
  if(mode==='montage') assert(parts.some(scene=>scene.material!==undefined),'Assign at least one supplied material');
  return {text:parts.map(scene=>scene.text.trim()).join('\n'),parts,materials};
}

export function voicedTimeline(input,alignment,duration){
  assert(Number.isFinite(duration)&&duration>0,'Invalid decoded narration length');
  const frames=Math.ceil(duration*FPS-1e-7);
  const starts=alignment?.character_start_times_seconds;
  const ends=alignment?.character_end_times_seconds;
  const chars=alignment?.characters;
  assert(Array.isArray(chars)&&chars.length===starts?.length&&chars.length===ends?.length,
    'Missing character timestamps from the narration provider');
  const units=[];
  for(const [index,character] of chars.entries()){
    const start=starts[index],end=ends[index];
    assert(typeof character==='string'&&Number.isFinite(start)&&Number.isFinite(end)&&
      start>=0&&end>=start&&end<=duration+.05&&(!index||start+.01>=starts[index-1]),'Invalid narration timestamp');
    for(const text of Array.from(character.normalize('NFC')).filter(ch=>!/^\s$/u.test(ch))){
      units.push({text,from:Math.min(frames-1,Math.floor(start*FPS+1e-7)),
        to:Math.min(frames,Math.ceil(end*FPS-1e-7))});
    }
  }
  assert.equal(units.map(unit=>unit.text).join(''),input.text.normalize('NFC').replace(/\s+/gu,''),
    'Original script and alignment text differ');
  let cursor=0;
  const rows=input.parts.map((scene,index)=>{
    const length=Array.from(scene.text.normalize('NFC').replace(/\s+/gu,'')).length;
    const tokens=units.slice(cursor,cursor+length);
    cursor+=length;
    return {...scene,from:index?tokens[0].from:0,tokens};
  });
  return {fps:FPS,frames,scenes:rows.map((scene,index)=>{
    const end=rows[index+1]?.from??frames;
    assert(end>scene.from,'Scene is shorter than one frame');
    const row={...scene,length:end-scene.from};
    return row.workflow?{...row,cues:workflowCues(row)}:row;
  })};
}

export function captionRequest(mode,timeline){
  const spoken=timeline.scenes
    ?timeline.scenes.map(({text,from,length,tokens,highlights=[]})=>{
      const units=tokens.map(token=>token.text);
      const emphasis=highlights.map(term=>{
        const chars=Array.from(term.normalize('NFC').replace(/\s+/gu,''));
        const start=units.findIndex((_,index)=>chars.every((char,offset)=>units[index+offset]===char));
        assert(start>=0,'Cannot align highlight: '+term);
        const first=tokens[start].from;
        return {term,from:first,length:Math.max(1,tokens[start+chars.length-1].to-first)};
      });
      return {text,from,length,tokens,highlights:emphasis};
    })
    :timeline.captions.map(caption=>({...caption,highlights:(timeline.emphasis??[])
      .filter(item=>item.captionFrom===caption.from).map(({term,from,length})=>({term,from,length}))}));
  return {version:1,provider:'Captions AI',mode,width:timeline.width??WIDTH,height:timeline.height??HEIGHT,
    fps:timeline.fps,frames:timeline.frames,spoken};
}

export function editorialNotes(scenes=[]){
  return scenes.flatMap((scene,index)=>{
    const key=scene.material;
    const repeatedSource=key!==undefined&&scenes[index-1]?.material===key&&scenes[index-2]?.material===key&&
      !scene.trim&&!scenes[index-1].trim&&!scenes[index-2].trim;
    const repeatedTextOnly=index>=2&&scenes.slice(index-2,index+1).every(row=>
      !row.material&&!row.demo&&!row.compare&&!row.data&&!row.motion&&!row.workflow&&!row.story);
    return repeatedSource||repeatedTextOnly?[{scene:index+1,frame:scene.from,reason:'连续三幕缺少新的画面信息，请核对该处'}]:[];
  });
}

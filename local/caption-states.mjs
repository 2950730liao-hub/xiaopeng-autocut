import assert from 'node:assert/strict';

/** Evaluate the original Remotion visibility intervals and render each visual state once. */
export function captionStates(pages, frames){
  assert(Number.isSafeInteger(frames)&&frames>0,'Expected a positive frame count');
  assert(Array.isArray(pages),'Expected an array of caption pages');
  const frameAt=ms=>Math.ceil(ms*30/1000);
  const framed=pages.map(page=>{
    assert(Array.isArray(page)&&page.length>0,'Caption pages must contain tokens');
    return page.map(({text,startMs,endMs})=>{
      assert(typeof text==='string'&&Number.isFinite(startMs)&&Number.isFinite(endMs)&&
        startMs>=0&&endMs>=startMs,'Invalid caption token');
      return {text,from:frameAt(startMs),to:frameAt(endMs)};
    });
  });
  const boundaries=new Set([0,frames]);
  for(const page of framed){
    for(const {from,to} of page){
      if(from<frames) boundaries.add(from);
      if(to<frames) boundaries.add(to);
    }
  }
  const ordered=[...boundaries].sort((a,b)=>a-b);
  const states=[];
  const ids=new Map();
  const runs=[];
  for(let i=0;i<ordered.length-1;i++){
    const frame=ordered[i];
    const count=ordered[i+1]-frame;
    const visible=framed.filter(page=>frame>=page[0].from&&frame<page.at(-1).to).map(page=>({
      tokens:page.map(({text,from,to})=>({text,active:frame>=from&&frame<to})),
    }));
    const key=JSON.stringify(visible);
    if(!ids.has(key)){
      ids.set(key,states.length);
      states.push(visible);
    }
    const id=ids.get(key);
    const previous=runs.at(-1);
    if(previous?.id===id) previous.count+=count;
    else runs.push({id,count});
  }
  return {states,runs};
}

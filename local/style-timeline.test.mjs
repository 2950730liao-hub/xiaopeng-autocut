import test from 'node:test';
import assert from 'node:assert/strict';
import {styleTimeline} from './style-timeline.mjs';

const timeline={
  fps:30,sourceSha256:'fixture',
  clips:[{sourceFrame:30,from:0,length:30}],
  captions:[{from:2,length:24,text:'勇气和勇气'}],
};
const transcript={sourceSha256:'fixture',words:[
  {id:0,text:'去掉',start:0,end:.5},
  {id:1,text:'勇气',start:1.1,end:1.2},
  {id:2,text:'和',start:1.2,end:1.3},
  {id:3,text:'勇气',start:1.3,end:1.5},
]};
test('emphasis follows a retained spoken occurrence after retiming and preserves the timeline',()=>{
  const styled=styleTimeline(timeline,transcript,[{term:'勇气',occurrence:2,mode:'inline'}]);
  assert.deepEqual(styled.emphasis,[{term:'勇气',from:9,length:17,captionFrom:2,captionOffset:3,mode:'inline'}]);
  assert.deepEqual(styled.clips,timeline.clips);
  assert.deepEqual(styled.captions,timeline.captions);
});
test('removed words and mismatched source revisions cannot become highlights',()=>{
  assert.throws(()=>styleTimeline(timeline,transcript,[{term:'去掉'}]),/not found in retained speech/);
  assert.throws(()=>styleTimeline(timeline,{...transcript,sourceSha256:'other'},[]),/source differ/);
});

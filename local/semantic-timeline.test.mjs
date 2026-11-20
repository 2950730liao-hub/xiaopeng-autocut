import test from 'node:test';
import assert from 'node:assert/strict';
import {applySemanticPlan} from './semantic-timeline.mjs';
import {adaptiveSoundGain,soundEvents} from './sound-plan.mjs';

const timeline={
  frames:160,
  clips:[{from:0,sourceFrame:60,length:160}],
  captions:[{from:80,length:20,text:'财务透明'}],
  cues:[{word:12,from:80,length:24,text:'02 财务透明',sound:true}],
  emphasis:[{term:'财务透明',from:83,length:15,mode:'inline'}],
};
const chapter={anchor:{word:12},kind:'card',step:2,total:3,text:'财务透明',soundFile:'step.wav'};

test('chapter replaces simultaneous highlighting, preserves speech and owns the sound',()=>{
  const styled=applySemanticPlan(timeline,[chapter]);
  assert.equal(styled.clips,timeline.clips);
  assert.equal(styled.captions,timeline.captions);
  assert.equal(styled.cues[0].from,80);
  assert.deepEqual(styled.emphasis,[]);
  assert.deepEqual(soundEvents({...styled,audioGains:{80:.73}}),[
    {from:80,file:'step.wav',gain:.73,text:'财务透明',kind:'semantic'},
  ]);
});

test('protection action stays bound to the spoken keyword',()=>{
  const action=applySemanticPlan({...timeline,cues:[]},[
    {anchor:{term:'财务透明'},kind:'action',motion:'shield'},
  ]);
  assert.equal(action.cues[0].from,83);
  assert.equal(action.cues[0].visual.motion,'shield');
  assert.deepEqual(soundEvents(action),[]);
});

test('invalid assets, anchors, and simultaneous focal overlays fail before rendering',()=>{
  assert.throws(()=>applySemanticPlan(timeline,[{...chapter,soundFile:'../step.wav'}]),/basename/);
  assert.throws(()=>applySemanticPlan(timeline,[{...chapter,anchor:{word:13}}]),/unique/);
  assert.throws(()=>applySemanticPlan(timeline,[{...chapter,kind:'image'}]),/existing still/);
  assert.throws(()=>applySemanticPlan(timeline,[chapter,{...chapter,anchor:{term:'财务透明'}}]),/Overlapping/);
});

test('local gain responds to speech level with bounded fallback',()=>{
  assert.equal(adaptiveSoundGain(.1,.1),.7);
  assert.equal(adaptiveSoundGain(.2,.1),1.4);
  assert.equal(adaptiveSoundGain(0,.6),.16);
  assert.equal(adaptiveSoundGain(.5,.03),1.8);
  assert.throws(()=>adaptiveSoundGain(.15,0),/audible onset/);
});

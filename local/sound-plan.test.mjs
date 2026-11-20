import test from 'node:test';
import assert from 'node:assert/strict';
import {soundEvents,voiceGainAt} from './sound-plan.mjs';

const timeline={
  cues:[{from:0,sound:true,text:'开场'},{from:60,sound:true,text:'第二点'},{from:120,text:'素材'}],
  emphasis:[{from:30,mode:'large',term:'三件事'},{from:60,mode:'inline',term:'财务透明'}],
};
test('keyword audio uses the visual onset and replaces any same-frame chapter tap',()=>{
  assert.deepEqual(soundEvents(timeline).map(({from,kind,file})=>[from,kind,file]),[
    [0,'cue','tap.wav'],[30,'keyword','keyword-pop.wav'],[60,'keyword','keyword-tick.wav'],
  ]);
});
test('rough previews and non-sound cues do not add taps',()=>{
  assert.deepEqual(soundEvents(timeline,true),[]);
  assert.deepEqual(soundEvents({cues:[{from:0,sound:false}],emphasis:[]}),[]);
});
test('only keyword hits briefly lower speech',()=>{
  const events=soundEvents(timeline);
  assert.equal(voiceGainAt(.03,events,30),1);
  assert.equal(voiceGainAt(.97,events,30),1);
  assert.ok(Math.abs(voiceGainAt(1.03,events,30)-.66)<1e-9);
  assert.ok(voiceGainAt(1.09,events,30)>.66);
  assert.equal(voiceGainAt(1.13,events,30),1);
});

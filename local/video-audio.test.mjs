import assert from 'node:assert/strict';
import test from 'node:test';
import {audioPlan} from './video-audio.mjs';

const timeline={fps:30,frames:180,scenes:[{from:30,length:60,tokens:[
  {text:'查',from:42},{text:'到',from:46},
]}]};

test('event sound follows its spoken anchor and leaves music opt-in',()=>{
  const effect={file:'click.wav',scene:1,anchor:'查到',offsetFrames:2};
  const result=audioPlan({effects:[effect]},timeline);
  assert.equal(result.music,undefined);
  assert.deepEqual(result.effects,[{...effect,frame:44,gain:.45}]);
  assert.equal(audioPlan({music:{file:'quiet.wav'}},timeline).music.gain,.14);
});

test('invalid and competing event sounds fail before mixing',()=>{
  assert.throws(()=>audioPlan({effects:[{frame:180}]},timeline),/outside the timeline/);
  assert.throws(()=>audioPlan({effects:[{scene:1,anchor:'找不到'}]},timeline),/not in its scene/);
  assert.throws(()=>audioPlan({effects:[{frame:30},{scene:1}]},timeline),/one focal sound/);
});

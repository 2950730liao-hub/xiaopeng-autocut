import assert from 'node:assert/strict';
import test from 'node:test';
import {canvas,captionRequest,editorialNotes,scriptInput,voicedTimeline} from './video-plan.mjs';
import {previewAss} from './video-services.mjs';
import {baseFrames,workflowMotion} from './workflow-view.mjs';
const lines=[{text:'先看开支。',highlights:['开支']},{text:'再看储蓄。'}];
const script=lines.map(line=>line.text).join('');
const characters=[...lines.map(line=>line.text).join('\n')];
const alignment={characters,
  character_start_times_seconds:characters.map((_,i)=>i*.2),
  character_end_times_seconds:characters.map((_,i)=>i*.2+.1)};

test('script and montage share the actual speech timeline and subtitle source',()=>{
  const plain=scriptInput('script',{script,scenes:lines});
  const montage=scriptInput('montage',{script,materials:[{id:'ledger',file:'ledger.png'}],
    scenes:[{...lines[0],material:'ledger'},lines[1]]});
  const first=voicedTimeline(plain,alignment,2.7);
  const second=voicedTimeline(montage,alignment,2.7);
  assert.equal(first.frames,81);
  assert.equal(first.scenes[1].from,36);
  assert.equal(first.scenes[1].length,45);
  assert.deepEqual(captionRequest('script',first).spoken,captionRequest('montage',second).spoken);
  assert.deepEqual(captionRequest('script',first).spoken[0].highlights,[{term:'开支',from:12,length:9}]);
});

test('rejects plans that change spoken text or never use a supplied montage asset',()=>{
  assert.throws(()=>scriptInput('script',{script,scenes:[lines[0]]}),/match the supplied script/);
  assert.throws(()=>scriptInput('montage',{script,materials:[{id:'ledger',file:'ledger.png'}],scenes:lines}),/Assign at least one/);
  assert.throws(()=>scriptInput('script',{script,scenes:[{...lines[0],highlights:['错字']},lines[1]]}),/must be spoken/);
  assert.throws(()=>voicedTimeline(scriptInput('script',{script}),{...alignment,characters:[]},2.7),/character timestamps/);
});

test('talk subtitles retain frame anchors and spoken emphasis',()=>{
  const request=captionRequest('talk',{fps:30,frames:99,captions:[{text:'开支',from:3,length:39}],
    emphasis:[{term:'开支',captionFrom:3,from:8,length:12}]});
  assert.deepEqual(request.spoken,[{text:'开支',from:3,length:39,highlights:[{term:'开支',from:8,length:12}]}]);
});

test('landscape previews and finals use their own caption canvas',()=>{
  assert.deepEqual(canvas('16:9',true),{width:1280,height:720});
  assert.deepEqual(canvas('16:9',false),{width:1920,height:1080});
  assert.deepEqual(canvas(undefined,true),{width:720,height:1280});
  const request=captionRequest('script',{...canvas('16:9',false),fps:30,frames:90,scenes:[]});
  assert.equal(request.width,1920);
  assert.equal(request.height,1080);
});

test('one visual owns the scene and repeated text-only scenes are flagged without blocking',()=>{
  const data={label:'耗时',before:12,after:4,unit:'分钟',detail:'教学示例'};
  assert.ok(scriptInput('script',{script,scenes:[{...lines[0],data},lines[1]]}).parts[0].data);
  assert.throws(()=>scriptInput('script',{script,scenes:[{...lines[0],data:{...data,after:-1}},lines[1]]}),/comparable/);
  assert.deepEqual(editorialNotes([{from:0},{from:30},{from:60}]).map(row=>row.scene),[3]);
  assert.deepEqual(editorialNotes([{from:0},{from:30,data},{from:60}]),[]);
});

test('preview captions preserve mixed Chinese and English word boundaries',()=>{
  const text='FDE 的全称是 Forward Deployed Engineer，中文是前沿部署工程师。帮企业搭一套真能跑起来的 AI 系统。';
  const tokens=Array.from(text.replace(/\s+/gu,'')).map((character,index)=>({text:character,from:index*2}));
  const output=previewAss({width:720,height:1280,fps:30,
    spoken:[{from:0,length:tokens.length*2,text,tokens}]});
  const lines=output.split('\n').filter(line=>line.startsWith('Dialogue:')).map(line=>line.split(',,')[2]);
  assert.match(lines.join(' '),/Forward Deployed Engineer/u);
  assert.ok(lines.every(line=>!line.includes('ployed')||line.includes('Deployed')));
  assert.ok(lines.some(line=>line.includes('AI 系统')));
});

test('workflow uses spoken frames and reserves the static picture hold after the camera returns',()=>{
  const text='先查工单。读条款并对照两项要求。客服确认后，把记录写回。';
  const characters=Array.from(text);
  const spans={characters,character_start_times_seconds:characters.map((_,i)=>i*.4),
    character_end_times_seconds:characters.map((_,i)=>i*.4+.2)};
  const workflow={id:'CS-1042',heading:'售后案例',subject:'退款申请',request:'商品还没拆封，能退吗？',
    source:'售后知识库',clauses:['签收后七天内','商品未拆封'],result:'已写回',
    anchors:{lookup:'查工单',evidence:'读条款',approve:'客服确认',write:'把记录写回'}};
  const input=scriptInput('script',{format:'16:9',script:text,scenes:[{text,workflow}]});
  const timeline=voicedTimeline(input,spans,characters.length*.4+4);
  const scene=timeline.scenes[0];
  assert.equal(scene.cues.lookup,12);
  const motion=workflowMotion(scene);
  assert.ok(motion.pushEnd<motion.pull&&motion.pullEnd<=motion.approve);
  assert.ok(baseFrames(scene,30)>motion.pullEnd);
  assert.ok(baseFrames(scene,30)<scene.length);
  const reversed={...workflow,anchors:{...workflow.anchors,write:'先查工单'}};
  assert.throws(()=>voicedTimeline(scriptInput('script',{format:'16:9',script:text,scenes:[{text,workflow:reversed}]}),
    spans,characters.length*.4+4),/increasing frames/);
});

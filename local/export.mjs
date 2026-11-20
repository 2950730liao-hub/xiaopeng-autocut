/** Run from a render directory with a pinned Remotion project and timeline.json. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import {measureAudioGains,mux,run} from './mux.mjs';

const [destination = 'final.mp4', mode = 'final', frameRange] = process.argv.slice(2);
assert(['final', 'rough'].includes(mode), 'Mode must be final or rough');
const root = process.cwd();
const started = performance.now();
const timeline = JSON.parse(await readFile('timeline.json', 'utf8'));
let range;
if(frameRange!==undefined){
  assert(/^\d+:\d+$/.test(frameRange),'Frame range must be START:END (end excluded)');
  const [start,end]=frameRange.split(':').map(Number);
  assert(start<end&&end<=timeline.frames,'Frame range exceeds timeline');
  range={start,end};
}
const prefix=range?`${mode}-${range.start}-${range.end}`:mode;
const json = prefix + '-render.json';
const picture = prefix + '-picture.mp4';
const rough = mode === 'rough';
timeline.audioGains=measureAudioGains(timeline,rough);
await writeFile(json, JSON.stringify({...timeline,rough,hasFont:existsSync('public/caption.otf')}));
const remotion = process.platform === 'win32' ?
  path.resolve('node_modules/@remotion/cli/remotion-cli.js') :
  path.resolve('node_modules/.bin/remotion');
const concurrency = process.env.REMOTION_FRAME_CONCURRENCY ?? '3';
const renderArgs = ['render','film.tsx','LocalTalkingHead',picture,'--props='+json,
  '--public-dir='+path.join(root,'public'),'--muted','--concurrency='+concurrency,'--log=warn'];
if(range) renderArgs.push(`--frames=${range.start}-${range.end-1}`);
run(process.platform === 'win32' ? process.execPath : remotion,
  process.platform === 'win32' ? [remotion,...renderArgs] : renderArgs);
const renderSeconds=(performance.now()-started)/1000;
mux(timeline,picture,destination,rough,range);
const timing={renderSeconds:+renderSeconds.toFixed(3),exportAndDecodeSeconds:+((performance.now()-started)/1000).toFixed(3)};
await writeFile(prefix+'-timing.json',JSON.stringify(timing,null,2)+'\n');
console.log(timing);

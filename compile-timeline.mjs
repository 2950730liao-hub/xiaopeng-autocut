// Compile a per-video edit plan and existing rough-cut captions onto one frame clock.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const [planPath, captionsPath, outputPath, duration] = process.argv.slice(2);
assert(planPath && captionsPath && outputPath && Number(duration) > 0,
  'Usage: node compile-timeline.mjs PLAN.json CAPTIONS.json TIMELINE.json SOURCE_SECONDS');
const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const [plan, captions] = await Promise.all([load(planPath), load(captionsPath)]);
assert(Number.isInteger(plan.fps) && plan.fps > 0 && plan.sourceClock, 'Invalid source clock');
assert(Array.isArray(plan.clips) && plan.clips.length && Array.isArray(captions) && captions.length, 'Missing clips or captions');
const frame = (second) => Math.round(second * plan.fps);

let cursor = 0;
const clips = plan.clips.map((clip) => {
  const start = frame(clip.start);
  const end = frame(clip.end);
  const length = end - start;
  assert(clip.id && Number.isInteger(start) && start >= 0 && end <= frame(Number(duration)) && length > 0,
    'Invalid clip ' + clip.id);
  const result = { ...clip, sourceFrame: start, from: cursor, length };
  cursor += length;
  return result;
});
assert.equal(new Set(clips.map(({ id }) => id)).size, clips.length, 'Duplicate clip id');
const sourceOrder = [...clips].sort((a, b) => a.sourceFrame - b.sourceFrame);
for (const [index, clip] of sourceOrder.entries()) {
  const previous = sourceOrder[index - 1];
  assert(!previous || previous.sourceFrame + previous.length <= clip.sourceFrame, 'Source clips overlap');
}

const mappedCaptions = clips.flatMap((clip) => captions.flatMap((caption) => {
  const start = frame(caption.startMs / 1000);
  const end = frame(caption.endMs / 1000);
  if (end <= clip.sourceFrame || start >= clip.sourceFrame + clip.length) return [];
  // A whole spoken cue must stay inside one edit. Boundary changes require a corrected transcript.
  assert(start >= clip.sourceFrame && end <= clip.sourceFrame + clip.length && end > start,
    'Cut crosses subtitle ' + caption.text);
  return [{ text: caption.text, from: clip.from + start - clip.sourceFrame, length: end - start }];
}));
const cues = plan.cues.map((cue) => {
  const clip = clips.find(({ id }) => id === cue.clip);
  assert(clip && cue.quote, 'Unknown cue source ' + cue.clip);
  const offset = (second) => frame(second) - clip.sourceFrame;
  const start = offset(cue.at);
  const end = offset(cue.end);
  assert(start >= 0 && end > start && end <= clip.length, 'Cue outside clip ' + cue.title);
  const quoteMatch = captions.some((caption) =>
    caption.text.includes(cue.quote) &&
    offset(caption.startMs / 1000) < end &&
    offset(caption.endMs / 1000) > start);
  assert(quoteMatch, 'Missing source quote ' + cue.title);
  const beats = (cue.beats ?? []).map((beat) => {
    const relative = offset(beat.at) - start;
    assert(relative >= 0 && relative < end - start, 'Beat outside cue ' + cue.title);
    return { ...beat, relative };
  });
  return { ...cue, from: clip.from + start, length: end - start, beats };
});
await writeFile(outputPath, JSON.stringify({ ...plan, clips, captions: mappedCaptions, cues, frames: cursor }, null, 2) + '\n');

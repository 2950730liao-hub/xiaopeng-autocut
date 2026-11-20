import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

/**
 * Locate a visible keyword by its spoken tokens. The selected caption remains
 * intact, and the original media/voice edit can be rendered again unchanged.
 */
export function styleTimeline(timeline, transcript, keywords) {
  assert.equal(timeline.sourceSha256,transcript.sourceSha256,'Timeline and transcript source differ');
  const {fps}=timeline;
  const words=transcript.words.flatMap(word=>{
    const clip=timeline.clips.find(({sourceFrame,length})=>
      word.start*fps>=sourceFrame-.001 && word.end*fps<=sourceFrame+length+.001);
    if(!clip) return [];
    const offset=clip.from-clip.sourceFrame;
    return [{...word,from:Math.round(word.start*fps)+offset,end:Math.round(word.end*fps)+offset}];
  });
  let offset=0;
  const offsets=words.map(word=>{
    const current=offset;
    offset+=word.text.length;
    return current;
  });
  const speech=words.map(({text})=>text).join('');
  const emphasis=keywords.map(({term,occurrence=1,mode='large',holdFrames=11})=>{
    assert(typeof term==='string'&&term.length&&Number.isInteger(occurrence)&&occurrence>0,'Invalid keyword');
    assert(['large','inline'].includes(mode)&&Number.isInteger(holdFrames)&&holdFrames>=0,'Invalid keyword style');
    let start=-1;
    for(let i=0;i<occurrence;i++){
      start=speech.indexOf(term,start+1);
      assert(start>=0,'Keyword not found in retained speech: '+term);
    }
    const end=start+term.length-1;
    const first=offsets.findLastIndex(x=>x<=start);
    const last=offsets.findLastIndex(x=>x<=end);
    assert(words[last].id-words[first].id===last-first,'Keyword crosses a removed word: '+term);
    const from=words[first].from;
    const line=timeline.captions.find(c=>c.from<=from && from<c.from+c.length && c.text.includes(term));
    assert(line,'Keyword is not in a single caption at the spoken time: '+term);
    const firstInLine=words.findIndex(word=>word.from>=line.from);
    let captionOffset=-1;
    for(let at=speech.indexOf(term,offsets[firstInLine]);at>=0&&at<=start;at=speech.indexOf(term,at+1)){
      captionOffset=line.text.indexOf(term,captionOffset+1);
      assert(captionOffset>=0,'Repeated keyword does not match caption: '+term);
    }
    const length=Math.min(line.from+line.length,words[last].end+holdFrames)-from;
    assert(length>0,'Keyword has no visible frame: '+term);
    return {term,from,length,captionFrom:line.from,captionOffset,mode};
  }).sort((a,b)=>a.from-b.from);
  for(const [i,item] of emphasis.entries()){
    const before=emphasis[i-1];
    assert(!before||before.from+before.length<=item.from,'Overlapping emphasis: '+item.term);
  }
  return {...timeline,templateStyle:true,emphasis};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [timeline,transcript,keywords,output]=process.argv.slice(2);
  assert(output,'Usage: style-timeline.mjs TIMELINE TRANSCRIPT KEYWORDS OUTPUT');
  const read=async path=>JSON.parse(await readFile(path,'utf8'));
  const inputs=await Promise.all([timeline,transcript,keywords].map(read));
  await writeFile(output,JSON.stringify(styleTimeline(...inputs),null,2)+'\n');
}

import assert from 'node:assert/strict';

export const focus={x:-408,y:-134,scale:1.32};
export const workflowCss=`
@font-face{font-family:WorkflowSans;src:local("PingFang SC Regular"),local("PingFangSC-Regular"),local("Hiragino Sans GB W3")}
.workflow{position:absolute;inset:0;background:radial-gradient(ellipse at 74% 1%,#4c3861 0%,#282238 57%,#1b1827 92%);color:#262035;font-family:WorkflowSans,sans-serif;overflow:hidden;z-index:4}
.workflow .camera{width:100%;height:100%;padding:31px 76px 101px;transform-origin:0 0;display:flex;flex-direction:column;gap:16px}
.workflow .mast{height:38px;flex:none;display:flex;justify-content:space-between;align-items:center;color:#f0e6fa;font-size:18px}
.workflow .mast b{background:#d6beff;color:#2d1d42;border-radius:7px;padding:5px 9px;margin-right:12px}
.workflow .window{background:#f8f6fb;border:1px solid #e5dff0;border-radius:20px;overflow:hidden;flex:1;box-shadow:0 22px 52px #150f24a0}
.workflow .toolbar{position:relative;background:#fff;border-bottom:1px solid #e6dfef;padding:18px 36px;height:100px}
.workflow .toolbar small{font-size:16px;color:#625477}
.workflow h1{font-size:36px;line-height:1.16;margin:4px 0}
.workflow .close-title{position:absolute;left:580px;top:42px;font-size:26px;opacity:0}
.workflow .columns{display:grid;grid-template-columns:455px 1fr;gap:86px;padding:25px 36px 0}
.workflow .block-title{font-size:19px;color:#5f4a74;letter-spacing:1px;font-weight:700}
.workflow .message{font-size:29px;line-height:1.35;margin:17px 0 15px;padding-left:15px;border-left:4px solid #7856ca;overflow-wrap:anywhere}
.workflow .lookup{position:absolute;left:113px;top:355px;width:190px;height:47px;display:grid;place-items:center;background:#562faa;color:#fff;border-radius:9px;font-size:20px;font-weight:700}
.workflow .policy{border:1px solid #e4dbef;border-radius:12px;background:#fff;padding:14px 16px 14px;margin-top:14px;height:149px}
.workflow .policy small{display:block;color:#67527f;font-size:17px;margin-bottom:9px}
.workflow .clause{font-size:31px;font-weight:700;line-height:41px;white-space:nowrap}
.workflow .note{color:#62536f;font-size:17px;margin:9px 0 0}
.workflow .record{position:absolute;left:113px;right:113px;top:465px;padding-top:14px;border-top:1px solid #e6dfef;font-size:20px;font-weight:650}
.workflow .record small{display:block;color:#705d82;font-size:16px;margin-bottom:11px}`;

export function workflowCues(scene){
  if(!scene.workflow) return;
  const {anchors}=scene.workflow;
  const units=scene.tokens.map(token=>token.text).join('');
  const cues=Object.fromEntries(['lookup','evidence','approve','write'].map(key=>{
    const term=anchors[key].normalize('NFC').replace(/\s+/gu,'');
    const index=units.indexOf(term);
    assert(index>=0,`Missing workflow anchor: ${key}`);
    const offset=Array.from(units.slice(0,index)).length;
    return [key,scene.tokens[offset].from-scene.from];
  }));
  const {lookup,evidence,approve,write}=cues;
  assert(lookup<evidence&&evidence<approve&&approve<write&&write<scene.length,
    'Workflow anchors must align to increasing frames');
  return cues;
}

export function workflowMarkup(scene,id,attr,html){
  const w=scene.workflow;
  return `<article class="clip workflow" ${attr(id,scene,6)} data-layout-allow-overflow>
    <div class="camera"><div class="mast"><span><b>${html(w.badge??'实操')}</b>${html(w.heading)}</span><span>教学模拟</span></div>
      <div class="window">
        <header class="toolbar"><div class="intro"><small>${html(w.workspace??'业务工作台')}</small><h1>${html(w.subject)}　${html(w.id)}</h1></div>
          <div class="close-title">${html(w.id)}　/　${html(w.evidenceLabel??'规则依据')}</div>
        </header>
        <div class="columns"><section class="request"><div class="block-title">01　${html(w.requestLabel??'客户请求')}</div>
          <p class="message">${html(w.request)}</p><div class="lookup">${html(w.lookupLabel??'匹配业务规则')}</div></section>
          <section class="evidence"><div class="block-title">02　${html(w.evidenceLabel??'命中条款')}</div>
            <div class="policy"><small>${html(w.source)}</small>${w.clauses.map(clause=>`<div class="clause">${html(clause)}</div>`).join('')}</div>
            <p class="note">${html(w.note??'系统给出依据，由负责人确认。')}</p>
          </section>
        </div>
        <footer class="record"><small>03　处理记录</small></footer>
      </div>
    </div>
  </article>`;
}

export function workflowMotion(scene){
  const {lookup,evidence,approve,write}=scene.cues;
  const push=Math.max(lookup+1,evidence-15);
  const pushEnd=Math.max(push+1,evidence);
  const pull=Math.min(evidence+114,approve-9);
  const pullEnd=Math.min(approve,Math.max(pull+1,pull+16));
  assert(pull>pushEnd,'Allow time between evidence and approval');
  return {lookup,evidence,approve,write,push,pushEnd,pull,pullEnd,focus};
}

export function workflowGsap(scene,id,fps){
  const timing=workflowMotion(scene);
  const at=key=>(scene.from+timing[key])/fps;
  const duration=(a,b)=>(timing[b]-timing[a])/fps;
  const select=cls=>`#${id} .${cls}`;
  const peripheral=['request','intro','mast','record'].map(select).join(', ');
  return `
    tl.fromTo(${JSON.stringify(select('evidence'))},{opacity:.16},{opacity:1,duration:.38},${at('push')});
    tl.to(${JSON.stringify(peripheral)},{opacity:0,duration:.24},${at('push')});
    tl.to(${JSON.stringify(peripheral)},{opacity:1,duration:.31},${at('pull')+.17});
    tl.to(${JSON.stringify(select('close-title'))},{opacity:1,duration:.22},${at('push')+.20});
    tl.to(${JSON.stringify(select('close-title'))},{opacity:0,duration:.22},${at('pull')});
    tl.to(${JSON.stringify(select('camera'))},{...${JSON.stringify(focus)},duration:${duration('push','pushEnd')},ease:"power2.inOut"},${at('push')});
    tl.to(${JSON.stringify(select('camera'))},{x:0,y:0,scale:1,duration:${duration('pull','pullEnd')},ease:"power2.inOut"},${at('pull')});`;
}

export const storyCss=`
.story{position:absolute;inset:0;z-index:3;padding:50px 81px 115px;color:#f6eefb;font-family:WorkflowSans,sans-serif}
.story-header{display:flex;align-items:center;gap:18px;color:#d3b9ed;font-size:21px;font-weight:650}
.story-header::before{content:"";height:3px;width:40px;background:#c39cf4}
.story h1{font-size:56px;line-height:1.08;margin:22px 0 32px;letter-spacing:-.055em}
.story .story-items{display:grid;gap:19px;margin:0;padding:0;list-style:none}
.story .story-item{min-width:0}
.story .story-item strong{display:block;font-size:31px;line-height:1.25}
.story .story-item span{display:block;font-size:22px;line-height:1.35;margin-top:10px;color:#efe2fa}
.story .story-note{margin:24px 0 0;font-size:20px;color:#d0bfdc}
.story.lead h1{font-size:66px;max-width:840px;margin-bottom:40px}
.lead .story-items{grid-auto-columns:1fr;grid-auto-flow:column;gap:33px}
.lead .story-item{border-left:3px solid #a17ccf;padding:4px 18px}
.story.path .story-items{grid-auto-columns:1fr;grid-auto-flow:column;gap:33px}
.path .story-item{position:relative;min-height:156px;background:#fbf7ff;border:1px solid #e4d6f7;border-radius:15px;color:#242036;padding:20px}
.path .story-item:not(:last-child)::after{content:"→";position:absolute;right:-29px;top:45px;font-size:26px;color:#c4a0ee}
.path .story-item span{color:#675579}
.story.evidence .story-items{gap:2px;max-width:100%;background:#fcf8ff;color:#2c233a;border-radius:15px;overflow:hidden}
.evidence .story-item{display:grid;grid-template-columns:260px 1fr;gap:20px;align-items:center;padding:18px 24px;border-bottom:1px solid #ebe3f2}
.evidence .story-item strong{font-size:24px;color:#634681}
.evidence .story-item span{margin-top:0;color:#2c233a;font-size:24px}
.story.check .story-items{gap:17px;max-width:1050px}
.check .story-item{display:grid;grid-template-columns:36px 260px 1fr;align-items:center;gap:10px;border-bottom:1px solid #786398;padding-bottom:12px}
.check .story-item::before{content:"✓";color:#c19ae9;font-size:27px;font-weight:700}
.check .story-item strong,.check .story-item span{font-size:25px;margin:0}`;

export function storyMarkup(scene,id,attr,html){
  const story=scene.story;
  const items=story.items.map(item=>`<li class="story-item"><strong>${html(item.label)}</strong><span>${html(item.detail)}</span></li>`).join('');
  return `<article class="clip story ${html(story.layout)}" ${attr(id,scene,6)}><div class="story-header">${html(story.kicker)}</div>
    <h1>${html(scene.title)}</h1><ul class="story-items">${items}</ul>
    <p class="story-note">${html(story.note??'')}</p></article>`;
}

function storyAnimation(scene,fps){
  const length=(scene.displayLength??scene.length)/fps;
  return {duration:Math.min(.38,length*.22),stagger:Math.min(.17,length*.1)};
}

export function storyGsap(scene,id,fps){
  const selector=JSON.stringify(`#${id} .story-item`);
  const {duration,stagger}=storyAnimation(scene,fps);
  return `tl.from(${selector},{opacity:.35,y:10,duration:${duration},stagger:${stagger},ease:"power2.out"},${scene.from/fps});`;
}

/** The unfinished portion of these scene types is a static hold. */
export function baseFrames(scene,fps){
  if(scene.story){
    const {duration,stagger}=storyAnimation(scene,fps);
    return Math.min(scene.length,Math.ceil(fps*(duration+stagger*(scene.story.items.length-1)))+3);
  }
  if(scene.workflow){
    const {pull,pullEnd}=workflowMotion(scene);
    return Math.min(scene.length,Math.max(pullEnd,pull+Math.ceil(.48*fps))+2);
  }
  return scene.length;
}

import React, {useEffect, useState} from 'react';
import {
  AbsoluteFill, Audio, Composition, Img, OffthreadVideo, Sequence, cancelRender,
  continueRender, delayRender, interpolate, registerRoot, staticFile, useCurrentFrame,
} from 'remotion';
import {soundEvents,voiceGainAt} from './sound-plan.mjs';

type Clip = {from: number; sourceFrame: number; length: number};
type Caption = {from: number; length: number; text: string};
type Visual = {kind:'card'; side:'left'|'right'; step:number; total:number}
  | {kind:'image'; side:'left'|'right'}
  | {kind:'action'; side:'left'|'right'; motion:'shield'|'push'|'reveal'};
type Cue = {from:number; length:number; text:string; asset?:string; panel?:number; sound?:boolean;
  visual?:Visual; soundFile?:string};
type Emphasis = {term:string; from:number; length:number; captionFrom:number; captionOffset?:number; mode:'large'|'inline'};
type Timeline = {fps:number; frames:number; clips:Clip[]; captions:Caption[]; cues:Cue[];
  rough?:boolean; hasFont?:boolean; templateStyle?:boolean; emphasis?:Emphasis[]; audioGains?:Record<number,number>;
  hideCaptions?:boolean};

function LocalFont({templateStyle}:{templateStyle:boolean}) {
  const [handle] = useState(() => delayRender('加载字幕字体'));
  useEffect(() => {
    const files=[['LocalCaption','caption.otf']];
    if(templateStyle)files.push(['TemplateTitle','template-title.otf'],['TemplateKeyword','template-accent.ttf']);
    Promise.all(files.map(async ([family,file]) => {
      document.fonts.add(await new FontFace(family,'url('+staticFile(file)+')').load());
    })).then(()=>continueRender(handle)).catch(cancelRender);
  }, [handle,templateStyle]);
  return null;
}

function Accent({cue,templateStyle}: {cue:Cue;templateStyle:boolean}) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame,[0,7],[0,1],{extrapolateRight:'clamp'});
  return <AbsoluteFill style={{overflow:'hidden',opacity}}>
    {cue.asset && (cue.asset.endsWith('.mp4') ?
      <OffthreadVideo muted src={staticFile(cue.asset)} style={{width:'100%',height:'100%',objectFit:'cover'}}/> :
      <Img src={staticFile(cue.asset)} style={{position:'absolute',height:'100%',objectFit:'cover',
        width:cue.panel===undefined?'100%':'300%',left:-(cue.panel??0)*100+'%'}}/>)}
    <AbsoluteFill style={{background:'linear-gradient(#211910c9,transparent 52%,transparent 80%,#20190f86)'}}/>
    <div style={{position:'absolute',color:'#ffdda9',fontFamily:templateStyle?'TemplateTitle, sans-serif':undefined,
      fontSize:cue.asset ? 27 : 55,lineHeight:1.13,
      whiteSpace:'pre-line',left:60,right:58,top:118,textShadow:'0 3px 5px #333'}}>{cue.text}</div>
  </AbsoluteFill>;
}

function SemanticAccent({cue,visual}: {cue:Cue;visual:Visual}) {
  const frame=useCurrentFrame();
  const opacity=Math.min(1,(frame+1)/5,(cue.length-frame)/5);
  const travel=interpolate(frame,[0,10],[22,0],{extrapolateRight:'clamp'});
  const action=interpolate(frame,[0,9,14],[63,-2,0],{extrapolateRight:'clamp'});
  const gold='#f7d995';
  return <div style={{position:'absolute',top:visual.kind==='image'?148:155,[visual.side]:52,
    width:visual.kind==='image'?200:288,
    opacity,translate:`0 ${travel}px`,padding:17,borderRadius:18,
    border:'1px solid #ffffff36',boxShadow:'0 8px 28px #100c086a',background:'#241a14ee',
    color:'#fff7e6',boxSizing:'border-box',fontSize:37,lineHeight:1.2}}>
    {visual.kind==='card'&&<>
      <div style={{display:'flex',gap:7,marginBottom:12,fontFamily:'sans-serif',fontWeight:700}}>
        {Array.from({length:visual.total},(_,index)=>{
          const number=index+1;
          const current=number===visual.step;
          return <span key={number} style={{flex:1,minWidth:0,textAlign:'center',padding:'5px 0',
            background:current?gold:'#ffffff11',color:current?'#312013':gold,
            borderRadius:7,fontSize:visual.total>5?15:24}}>{String(number).padStart(2,'0')}</span>;
        })}
      </div>
      <div>{cue.text}</div>
    </>}
    {visual.kind==='action'&&<>
      <div style={{position:'relative',height:56,marginBottom:8,overflow:'hidden'}}>
        {visual.motion==='shield'?<>
          <div style={{position:'absolute',left:75,top:12,width:27,height:27,borderRadius:'50%',background:'#fff7e690'}}/>
          <div style={{position:'absolute',left:119,top:7,width:38,height:42,background:gold,
            clipPath:'polygon(0 0,100% 0,100% 65%,50% 100%,0 65%)',translate:`${action}px`}}/>
          <div style={{position:'absolute',left:179,top:13,color:gold,fontSize:30}}>‹‹</div>
        </>:<div style={{position:'absolute',left:55,top:14,width:104,height:24,borderRadius:6,
          background:gold,translate:visual.motion==='push'?`${-action}px`:undefined,
          clipPath:visual.motion==='reveal'?`inset(0 ${Math.max(0,action)}% 0 0)`:undefined}}/>}
      </div>
      <div>{cue.text}</div>
    </>}
    {visual.kind==='image'&&cue.asset&&<>
      <div style={{position:'relative',height:192,overflow:'hidden',borderRadius:9,marginBottom:7}}>
        <Img src={staticFile(cue.asset)} style={{position:'absolute',height:'100%',objectFit:'cover',
          width:cue.panel===undefined?'100%':'300%',left:-(cue.panel??0)*100+'%'}}/>
      </div>
      <div style={{fontSize:23}}>{cue.text}</div>
    </>}
  </div>;
}

function CaptionLine({caption,templateStyle,emphasis}:{
  caption:Caption; templateStyle:boolean; emphasis:Emphasis[];
}) {
  const frame=useCurrentFrame()+caption.from;
  const active=emphasis.find(item=>item.mode==='inline'&&item.from<=frame&&frame<item.from+item.length);
  const start=active?(active.captionOffset??caption.text.indexOf(active.term)):-1;
  return <div style={{position:'absolute',display:'flex',justifyContent:'center',textAlign:'center',
    left:templateStyle?53:45,right:templateStyle?53:45,bottom:130}}>
    <span style={{fontSize:templateStyle?37:34,lineHeight:1.3,textWrap:'balance',
      background:templateStyle?undefined:'#241a13dc',
      paintOrder:'stroke fill',WebkitTextStroke:templateStyle?'4px #16130f':undefined,
      textShadow:templateStyle?'0 3px 8px #17110fc9':undefined,
      color:'#fff9ea',padding:'8px 14px',borderRadius:8}}>
      {active&&start>=0?<>{caption.text.slice(0,start)}
        <span style={{color:'#ffdc77'}}>{active.term}</span>
        {caption.text.slice(start+active.term.length)}</>:caption.text}
    </span>
  </div>;
}

function LargeKeyword({item}:{item:Emphasis}) {
  const frame=useCurrentFrame();
  const enter=interpolate(frame,[0,4,8],[.72,1.06,1],{extrapolateRight:'clamp'});
  const fade=Math.min(1,(frame+1)/4,(item.length-frame)/5);
  return <div style={{position:'absolute',left:45,right:45,bottom:263,textAlign:'center',opacity:fade,
    scale:enter,color:'#ffdf80',fontFamily:'TemplateKeyword, serif',
    fontSize:item.term.length>6?61:item.term.length>4?70:84,lineHeight:1,
    whiteSpace:'nowrap',paintOrder:'stroke fill',WebkitTextStroke:'4px #272014',
    textShadow:'0 6px 9px #1f180add'}}>
    {item.term}
  </div>;
}

function Film({clips,captions,cues,fps,rough,hasFont,templateStyle=false,emphasis=[],audioGains={},hideCaptions=false}:Timeline) {
  const keywords=rough?[]:emphasis;
  const events=soundEvents({cues,emphasis,audioGains},rough);
  return <AbsoluteFill style={{background:'#161a17',fontFamily:'LocalCaption, sans-serif'}}>
    {(hasFont||templateStyle) && <LocalFont templateStyle={templateStyle}/>}
    {clips.map(clip=><Sequence key={clip.from} name={'源帧 '+clip.sourceFrame} from={clip.from} durationInFrames={clip.length}>
      <OffthreadVideo muted src={staticFile('source.mp4')} trimBefore={clip.sourceFrame}
        style={{width:'100%',height:'100%',objectFit:'contain'}}/>
    </Sequence>)}
    <Audio src={staticFile('voice.wav')} volume={frame=>voiceGainAt(frame/fps,events,fps)}/>
    {!rough && cues.map(cue=><Sequence key={cue.from} name={cue.text} from={cue.from} durationInFrames={cue.length}>
      {cue.visual?<SemanticAccent cue={cue} visual={cue.visual}/>:<Accent cue={cue} templateStyle={templateStyle}/>}
    </Sequence>)}
    {events.map(cue=><Sequence key={'audio-'+cue.from}
      from={cue.from} name={cue.text+' · 音效'}>
      <Audio src={staticFile(cue.file)} volume={cue.gain}/>
    </Sequence>)}
    {!hideCaptions&&keywords.filter(item=>item.mode==='large').map(item=><Sequence key={item.from} name={item.term} from={item.from} durationInFrames={item.length}>
      <LargeKeyword item={item}/>
    </Sequence>)}
    {!hideCaptions&&captions.map(caption=><Sequence key={caption.from} name={caption.text} from={caption.from} durationInFrames={caption.length}>
      <CaptionLine caption={caption} templateStyle={templateStyle}
        emphasis={keywords.filter(item=>item.captionFrom===caption.from)}/>
    </Sequence>)}
  </AbsoluteFill>;
}

const initial:Timeline = {fps:30,frames:1,clips:[],captions:[],cues:[]};
registerRoot(()=> <Composition id="LocalTalkingHead" component={Film} width={720} height={1280}
  fps={30} durationInFrames={1} defaultProps={initial}
  calculateMetadata={({props})=>({fps:props.fps,durationInFrames:props.frames})}/>);

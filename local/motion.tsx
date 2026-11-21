import React from 'react';
import {AbsoluteFill,Composition,Easing,interpolate,registerRoot,useCurrentFrame} from 'remotion';

type Motion = {
  kind:'action'|'progress'|'number'; label:string; frames:number; step?:number; total?:number; transitionFrames?:number;
};

function MotionCard({kind,label,step=1,total=3,transitionFrames=12}:Motion){
  const frame=useCurrentFrame();
  const progress=interpolate(frame,[0,transitionFrames],[0,1],{extrapolateRight:'clamp'});
  const ink='#18362d';
  const accent='#b8452b';
  return <AbsoluteFill style={{background:'#e9e5d7',color:ink,fontFamily:'PingFang SC, sans-serif',
    justifyContent:'center',padding:40,overflow:'hidden'}}>
    {kind==='progress'&&<div style={{display:'flex',gap:8,marginBottom:26}}>
      {Array.from({length:total},(_,i)=><span key={i} style={{flex:1,minWidth:0,padding:'11px 0',
        textAlign:'center',fontSize:20,borderRadius:10,color:i+1===step?'#fbf3e3':ink,
        background:i+1===step?accent:'#d2dbcb',scale:i+1===step?.8+.2*progress:1}}>
        {String(i+1).padStart(2,'0')}
      </span>)}
    </div>}
    {kind==='action'&&<div style={{height:60,position:'relative',marginBottom:22}}>
      <div style={{position:'absolute',width:300,height:8,top:25,left:0,background:'#c5d0bc',borderRadius:8}}/>
      <div style={{position:'absolute',width:56,height:56,top:0,left:244*progress,
        background:accent,borderRadius:'50%',color:'#fbf3e3',textAlign:'center',fontSize:37}}>→</div>
    </div>}
    <div style={{fontFamily:'Songti SC, serif',fontWeight:700,fontSize:kind==='number'?79:47,
      overflowWrap:'anywhere',opacity:.25+.75*progress,translate:`0 ${22*(1-progress)}px`}}>
      {label}
    </div>
  </AbsoluteFill>;
}

const initial:Motion={kind:'number',label:'三步',frames:30};

type WorkflowProps={
  frames:number; lookup:number; evidence:number; approve:number; write:number; push:number;
  pushEnd:number; pull:number; pullEnd:number; focus:{x:number;y:number;scale:number};
  terms:number[]; id:string; action:string; result:string; savedStatus:string;
};

function WorkflowOverlay(props:WorkflowProps){
  const {lookup,evidence,approve,write,push,pushEnd,pull,pullEnd,focus,terms,id,action,result,savedStatus}=props;
  const frame=useCurrentFrame();
  const at=(start:number,end:number,easing=Easing.out(Easing.cubic))=>
    interpolate(frame,[start,Math.max(start+1,end)],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing});
  const camera=at(push,pushEnd,Easing.inOut(Easing.cubic))-at(pull,pullEnd,Easing.inOut(Easing.cubic));
  const line=at(lookup,evidence+4);
  const clicked=frame>=approve;
  const saved=frame>=write;
  const success='#176549', accent='#7651cf';
  const okLabel=saved?'✓ '+savedStatus:clicked?'正在写回…':'待处理';
  const currentPointer=frame<push?[208,377,lookup]:[1054,521,approve];
  const [pointerX,pointerY,event]=currentPointer;
  const cursor=at(event-13,event)*(1-at(event+3,event+11))*(frame>=push?at(pullEnd-1,pullEnd+3):1);
  const approach=at(event-13,event,Easing.inOut(Easing.cubic));
  return <AbsoluteFill style={{overflow:'hidden',fontFamily:'PingFang SC,Hiragino Sans GB,sans-serif'}}>
    <AbsoluteFill style={{transformOrigin:'0 0',transform:`translate(${focus.x*camera}px,${focus.y*camera}px) scale(${1+(focus.scale-1)*camera})`}}>
      <svg width={1280} height={720} style={{position:'absolute',inset:0}}>
        <g opacity={1-at(pull-4,pullEnd)}>
          <path d="M 303 378 H 532 Q 558 378 570 354 L 575 344 Q 587 321 614 321 H 647" fill="none" stroke={accent}
            strokeWidth={4} strokeDasharray={1} pathLength={1} strokeDashoffset={1-line} strokeLinecap="round"/>
          {line>.98&&<path d="m637 315 10 6 -10 6" fill="none" stroke={accent} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round"/>}
        </g>
        {terms.map((length,i)=><rect key={i} x={671} y={326+41*i} width={(length*31+3)*at(evidence+11+14*i,evidence+22+14*i)}
          height={7} rx={3.5} fill="#bf9af1" opacity={.86}/>)}
      </svg>
      <div style={{position:'absolute',left:975,top:107,width:193,height:41,borderRadius:9,display:'grid',placeItems:'center',
        background:saved?'#d9f2e5':'#f0e8fa',color:saved?success:'#624981',fontSize:19,fontWeight:700}}>{okLabel}</div>
      <div style={{position:'absolute',left:940,top:495,width:226,height:50,borderRadius:10,display:'grid',placeItems:'center',
        opacity:at(pullEnd,pullEnd+9),background:saved?'#d9f2e5':clicked?'#eadcfd':'#562faa',
        color:saved?success:clicked?'#562faa':'white',fontSize:20,fontWeight:700}}>
        {saved?'✓ 写回完成':clicked?'正在写回…':action}
      </div>
      <div style={{position:'absolute',left:113,top:511,opacity:(1-camera)*(saved?at(write-1,write+8):1),
        transform:`translateY(${saved?5*(1-at(write-1,write+8)):0}px)`,fontSize:22,fontWeight:700,
        color:saved?success:clicked?'#562faa':'#453650'}}>
        {saved?`✓　${result}　${id}`:clicked?'✓　负责人已确认':'等待负责人确认'}
      </div>
    </AbsoluteFill>
    {cursor>0&&<svg width={36} height={41} style={{position:'absolute',left:pointerX-65*(1-approach),top:pointerY+34*(1-approach),opacity:cursor}}>
      <path d="M3 2v32l7-7 5 10 5-2-5-11h11z" fill="white" stroke="#29203e" strokeWidth={2.6} strokeLinejoin="round"/>
    </svg>}
    {[{frame:lookup,x:208,y:378},{frame:approve,x:1054,y:521},{frame:write,x:1071,y:126}].map(cue=>{
      if(frame<cue.frame||frame>=cue.frame+13) return null;
      const expand=at(cue.frame,cue.frame+13);
      return <div key={cue.frame} style={{position:'absolute',left:cue.x,top:cue.y,width:48,height:48,borderRadius:'50%',
        border:`3px solid ${saved?'#39a781':'#aa83ff'}`,opacity:1-expand,transform:`translate(-50%,-50%) scale(${.5+expand*1.3})`}}/>;
    })}
  </AbsoluteFill>;
}

const workflowDefaults:WorkflowProps={frames:220,lookup:20,evidence:62,approve:169,write:190,push:46,pushEnd:62,
  pull:141,pullEnd:158,focus:{x:-408,y:-134,scale:1.32},terms:[3,5],id:'CS-1042',action:'确认并写回',result:'记录已写回',savedStatus:'已回复'};

registerRoot(()=><>
  <Composition id="XiaopengMotion" component={MotionCard} width={540} height={360}
    fps={30} durationInFrames={30} defaultProps={initial}
    calculateMetadata={({props})=>({durationInFrames:props.frames})}/>
  <Composition id="WorkflowOverlay" component={WorkflowOverlay} width={1280} height={720}
    fps={30} durationInFrames={220} defaultProps={workflowDefaults}
    calculateMetadata={({props})=>({durationInFrames:props.frames})}/>
</>);

import React from 'react';
import {AbsoluteFill, Composition, registerRoot, useCurrentFrame} from 'remotion';

type Line = {tokens: {text: string; active: boolean}[]};
type Props = {states: Line[][]};

function CaptionOverlay({states}: Props) {
  const lines = states[useCurrentFrame()] ?? [];
  return <>{lines.map(({tokens}, lineIndex) => {
    const englishPage = tokens[0].text === 'Forward';
    return (
      <AbsoluteFill key={lineIndex} style={{justifyContent:'center',alignItems:'center',paddingInline:84}}>
        <div style={{fontFamily:'"Avenir Next", "PingFang SC", "Hiragino Sans GB", sans-serif',
          fontWeight:700,fontSize:englishPage?49:38,lineHeight:1.2,letterSpacing:englishPage?'-.025em':'.01em',
          padding:'5px 14px',whiteSpace:'pre',color:'#F9F5FF',textShadow:'0 2px 4px rgba(13,8,21,.8)'}}>
          {tokens.map((token, index) =>
            <span key={index} style={{color:token.active?'#D2B0FF':'#F9F5FF'}}>{token.text}</span>)}
        </div>
      </AbsoluteFill>
    );
  })}</>;
}

registerRoot(() => (
  <Composition id="CaptionOverlay" component={CaptionOverlay} width={1280} height={128} fps={30}
    durationInFrames={1} defaultProps={{states:[[]]} satisfies Props}
    calculateMetadata={({props}: {props: Props}) => ({durationInFrames:props.states.length})}/>
));

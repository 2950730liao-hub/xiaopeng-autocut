import React, {useEffect, useState} from 'react';
import {
  AbsoluteFill, Composition, Img, cancelRender, continueRender, delayRender, registerRoot, staticFile,
} from 'remotion';

type CoverProps = {
  portrait: string;
  fontFile: string;
  series: string;
  lines: [string, string];
};

function Cover({portrait, fontFile, series, lines}: CoverProps) {
  const [handle] = useState(() => delayRender('加载封面字体'));
  useEffect(() => {
    const face = new FontFace('CoverTitle', 'url(' + staticFile(fontFile) + ')');
    face.load().then((loaded) => {
      document.fonts.add(loaded);
      continueRender(handle);
    }).catch((error) => {
      // Fail the render rather than shipping a series with an unexpected font.
      cancelRender(error);
    });
  }, [fontFile, handle]);

  return (
    <AbsoluteFill style={{background: '#111b17', fontFamily: 'CoverTitle, sans-serif'}}>
      <Img src={staticFile(portrait)} style={{
        position: 'absolute', width: 1080, height: 1920, top: 145,
        objectFit: 'cover', filter: 'saturate(.83) contrast(1.06)',
      }} />
      <AbsoluteFill style={{
        background: 'linear-gradient(180deg,#101b16 0%,#101b16 22%,#131e19ee 29%,#111b1740 44%,transparent 59%,#101b16de 100%)',
      }} />
      <div style={{position: 'absolute', top: 440, left: 98, right: 98}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 16, color: '#a8e1c0', fontSize: 34, lineHeight: 1.2}}>
          <div style={{width: 40, height: 5, background: '#a8e1c0'}} />
          <span>{series}</span>
        </div>
        <div style={{marginTop: 20, fontSize: 102, lineHeight: 1.08, color: '#f7f2e5', letterSpacing: -2}}>
          <div style={{whiteSpace: 'nowrap'}}>{lines[0]}</div>
          <div style={{whiteSpace: 'nowrap', color: '#ffdc83'}}>{lines[1]}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

registerRoot(() => (
  <Composition id="VerticalCover" component={Cover} width={1080} height={1920}
    fps={24} durationInFrames={1}
    defaultProps={{portrait:'portrait.jpg', fontFile:'cover-title.otf', series:'AI 实战', lines:['AI 剪辑','怎么才可控？']}} />
));

"""Source-clock rough audition cleanup. No retiming, speech replacement or gain boost."""
import hashlib,json,wave
from pathlib import Path
import numpy as np
from scipy.signal import butter,sosfiltfilt
from scipy.ndimage import distance_transform_edt,gaussian_filter1d

POLICY='waveform_gap_deess_v2'

def _mask(length,sr,intervals,guard=0):
 out=np.zeros(length,dtype=bool)
 for w in intervals:
  a=max(0,round((w['start']-guard)*sr));b=min(length,round((w['end']+guard)*sr))
  if b>a:out[a:b]=True
 return out

def _events(db,sr,threshold=-.5):
 active=db<threshold;changes=np.diff(np.r_[False,active,False].astype(int));rows=[]
 for a,b in zip(np.flatnonzero(changes==1),np.flatnonzero(changes==-1)):
  if b-a>=round(.01*sr):rows.append({'start':a/sr,'end':b/sr,'minGainDb':float(db[a:b].min())})
 return rows

def clean_audio(audio,sample_rate,words,unknown_speech):
 """Gate only quiet word-free regions; de-ess only transient high-band excess."""
 if sample_rate!=48000:raise ValueError('Cleanup requires source-bound 48k PCM')
 a=np.asarray(audio,dtype=np.float64)
 if a.ndim!=2 or not len(a) or not np.isfinite(a).all():raise ValueError('Invalid PCM')
 n=len(a);frame=480;starts=np.arange(0,n,frame);ends=np.minimum(starts+frame,n)
 speech=_mask(n,sample_rate,words+unknown_speech)
 protected=_mask(n,sample_rate,words+unknown_speech,.08)
 power=np.mean(a*a,axis=1)
 rms=np.array([np.sqrt(power[x:y].mean()) for x,y in zip(starts,ends)])
 db=20*np.log10(np.maximum(rms,1e-9))
 voiced=np.array([speech[x:y].mean()>=.5 for x,y in zip(starts,ends)])
 reference=float(np.median(db[voiced&(db>-60)]))if np.any(voiced&(db>-60))else -24.
 ceiling=min(-24.,reference-12.);target=max(-55.,min(-42.,reference-35.))
 # Energy alone never identifies loud unaligned audio as a breath. Every
 # changed sample must also lie outside aligned-word/unknown-speech guards.
 eligible=np.repeat((db<=ceiling)&(db>-80),frame)[:n]&~protected
 # v2（2026-11-16 用户看片反馈）：比底噪明显响的声音（呼气、语气声，也包括咂嘴等杂音）最多压低 6 dB，
 # 避免一口气吸到一半突然静音。上限在底噪 +3～+9 dB 之间平滑过渡（避免阈值附近忽大忽小）；
 # 接近底噪的部分仍可压到目标电平（安静房间里通常本来就不需要深压）。
 quiet=(~voiced)&(db>-80)
 floor=float(np.percentile(db[quiet],10))if np.any(quiet)else None
 max_cut=np.interp(db-floor,[3.,9.],[-18.,-6.])if floor is not None else np.full(len(db),-18.)
 desired=np.repeat(np.clip(target-db,max_cut,0.),frame)[:n]
 smooth=gaussian_filter1d(desired[::frame],1.,mode='nearest')
 gap_db=np.interp(np.arange(n),starts+frame/2,smooth)
 edge=np.minimum(1.,distance_transform_edt(np.pad(eligible,(1,1)))[1:-1]/(.015*sample_rate))
 gap_db=np.clip(gap_db,-18.,0.)*edge
 # 平滑之后再保证：比底噪高 9 dB 以上的帧确实最多只压 6 dB。
 if floor is not None:gap_db=np.where(np.repeat(db>floor+9.,frame)[:n],np.maximum(gap_db,-6.),gap_db)
 gap_gain=10**(gap_db/20)
 # Zero-phase offline band extraction leaves the main voice below 4.5kHz
 # untouched. Control is linked across channels, avoiding stereo imbalance.
 high=np.zeros_like(a)
 if n>40:high=sosfiltfilt(butter(3,[4500,11000],btype='bandpass',fs=sample_rate,output='sos'),a,axis=0)
 hp=np.mean(high*high,axis=1)
 ratios=np.array([hp[x:y].mean()/max(1e-12,power[x:y].mean()) for x,y in zip(starts,ends)])
 high_db=10*np.log10(np.maximum(np.array([hp[x:y].mean()for x,y in zip(starts,ends)]),1e-18))
 deess_target=-np.clip((ratios-.35)/.5*6.,0.,6.)
 deess_target[~voiced|(high_db<max(-45.,reference-25.))]=0
 speech_edge=np.minimum(1.,distance_transform_edt(np.pad(speech,(1,1)))[1:-1]/(.005*sample_rate))
 deess_db=np.interp(np.arange(n),starts+frame/2,gaussian_filter1d(deess_target,.7,mode='nearest'))*speech_edge
 deess_gain=10**(deess_db/20)
 out=(a+high*(deess_gain[:,None]-1))*gap_gain[:,None]
 peak=float(np.max(np.abs(out)));safety=min(1.,.98/max(peak,1e-12));out*=safety
 receipt={'policy':POLICY,'sampleRate':sample_rate,'samples':n,'channels':a.shape[1],
  'wordGuardSeconds':.08,'gapMaxReductionDb':18,'noiseFloorDbfs':floor,'noiseFloorFrames':int(np.count_nonzero(quiet)),'breathMaxReductionDb':6,'deessMaxBandReductionDb':6,'deessBandHz':[4500,11000],
  'speechReferenceDbfs':reference,'gapCeilingDbfs':ceiling,'gapTargetDbfs':target,
  'safetyGainDb':float(20*np.log10(safety)),'gapEvents':_events(gap_db,sample_rate),
  'deessEvents':_events(deess_db,sample_rate),'inputPeak':float(np.max(np.abs(a))),'outputPeak':float(np.max(np.abs(out))),
  'frames':[{'start':int(x)/sample_rate,'end':int(y)/sample_rate,'inputRmsDbfs':float(db[i]),
   'outputRmsDbfs':float(10*np.log10(max(1e-18,np.mean(out[x:y]**2)))),
   'gapMinGainDb':float(gap_db[x:y].min()),'deessMinBandGainDb':float(deess_db[x:y].min()),'highBandRatio':float(ratios[i])}
   for i,(x,y)in enumerate(zip(starts,ends))]}
 return out,receipt

def mapped_speech(spans,mapping,sr):
 words=[];unknown=[]
 for s in spans:
  if not s.get('keep') or s.get('type')!='speech':continue
  ws=s.get('words',[])
  valid=ws and all(isinstance(w.get('start'),(int,float))and isinstance(w.get('end'),(int,float))and w['end']>w['start']for w in ws)
  for w in ws if valid else [s]:
   for row in mapping:
    lo=max(w['start'],row['sourceStartSample']/sr);hi=min(w['end'],row['sourceEndSample']/sr)
    if hi>lo:
     offset=(row['outStartSample']-row['sourceStartSample'])/sr
     (words if valid else unknown).append({'start':lo+offset,'end':hi+offset})
 return words,unknown

def process_audition(directory,spans,mapping,source_hash):
 directory=Path(directory);audio=directory/'rough-audio.wav';dry=directory/'rough-source-audio.wav'
 # A regenerated audition starts with a fresh dry assembly. Never process an
 # already processed track, and keep the exact source cut as an audit artifact.
 dry.write_bytes(audio.read_bytes())
 with wave.open(str(dry))as f:
  sr=f.getframerate();channels=f.getnchannels();assert f.getsampwidth()==2
  a=np.frombuffer(f.readframes(f.getnframes()),np.int16).reshape(-1,channels).astype(np.float64)/32768
 words,unknown=mapped_speech(spans,mapping,sr);out,receipt=clean_audio(a,sr,words,unknown)
 with wave.open(str(audio),'wb')as f:
  f.setframerate(sr);f.setnchannels(channels);f.setsampwidth(2);f.writeframes(np.rint(out*32768).clip(-32768,32767).astype(np.int16).tobytes())
 digest=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
 receipt.update({'sourceHash':source_hash,'mapping':mapping,'dryFile':dry.name,'drySha256':digest(dry),'processedFile':audio.name,'processedSha256':digest(audio),
  'wordIntervals':words,'unknownSpeechIntervals':unknown,'humanListeningClaimed':False})
 proof=directory/'rough-audio-processing.json';proof.write_text(json.dumps(receipt,ensure_ascii=False,indent=2))
 return {'policy':POLICY,'dryFile':dry.name,'drySha256':digest(dry),'processedFile':audio.name,'processedSha256':digest(audio),
  'proofFile':proof.name,'proofSha256':digest(proof),'samples':len(a),'sampleRate':sr,'gapEvents':len(receipt['gapEvents']),'deessEvents':len(receipt['deessEvents'])}

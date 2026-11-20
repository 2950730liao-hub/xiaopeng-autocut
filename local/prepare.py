"""Validate source-bound cuts and build a local Remotion timeline and voice track."""
import argparse
import json
import math
from pathlib import Path
import subprocess
import sys
import time
import wave
import numpy as np

from analyze import save_json, sha256

# Reuse the tested audio processor without starting the Web service.
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "server" / "autocut"))
from rough_audio import clean_audio

FPS = 30
SAMPLE_RATE = 48000
FRAME = SAMPLE_RATE // FPS
GUARD = .08
TAIL_GUARD = .12


def frame_bounds(start, end, fps=FPS):
    return math.ceil(start * fps - 1e-8), math.floor(end * fps + 1e-8)


def retakes(words, decisions, total, rms):
    cuts, held = [], []
    for entry in decisions:
        a, b, c, d = (entry.get(key) for key in ("from", "to", "keepFrom", "keepTo"))
        if any(type(x) is not int for x in (a, b, c, d)) or not 0 <= a < b <= c < d <= len(words):
            raise ValueError("A retake must bind an earlier word range to a later complete take")
        if not entry.get("reason", "").strip() or not any(not w.get("unaligned") for w in words[c:d]):
            raise ValueError("Missing reason or aligned word evidence")
        # Use source video frames. Expanding to a nearby frame must stay clear of
        # the preceding and following retained words.
        first = max(0, math.floor(words[a]["start"] * FPS + 1e-8)) if a else 0
        last = min(total, math.ceil(words[b - 1]["end"] * FPS - 1e-8))
        quiet = 10 ** (-32 / 20)
        if a:
            left = max(math.ceil((words[a-1]["end"] + .03) * FPS),
                first - (12 if words[a].get("unaligned") else 6))
            before = [k for k in range(left, first) if rms[k] <= quiet]
            if not before and words[a].get("unaligned"):
                held.append({"words":[a,b],"reason":"没有安全的重录起点，保留原话"})
                continue
            if before:
                first = before[-1]
        right = min(total-1, last+12,
            math.floor((words[b]["start"]-.035)*FPS) if b < len(words) else total-1)
        after = [k for k in range(last,right+1) if rms[k] <= quiet]
        if not after:
            held.append({"words":[a,b],"reason":"没有安全的重录尾点，保留原话"})
            continue
        last = after[0]
        if first >= last or (a and words[a-1]["end"] > first/FPS + 1e-8) or (
            b < len(words) and words[b]["start"] < last/FPS - 1e-8
        ):
            held.append({"words":[a,b],"reason":"切点与保留词边界冲突，保留原话"})
            continue
        cuts.append({"start": first, "end": last, "reason": entry["reason"], "type": "retake",
            "removeWords": [a,b], "retainWords": [c,d]})
    ordered = sorted(cuts, key=lambda cut: cut["start"])
    for i, cut in enumerate(ordered):
        if i and ordered[i-1]["end"] > cut["start"]:
            raise ValueError("Retake cuts overlap")
        c, d = cut["retainWords"]
        if any(other["removeWords"][0] < d and c < other["removeWords"][1] for other in ordered):
            raise ValueError("A retained replacement is itself removed")
    return ordered, held


def quiet_cuts(peak, rms, words, total):
    quiet = (peak <= 10**(-22/20)) & (rms <= 10**(-38/20))
    gaps = [(0, words[0]["start"] - TAIL_GUARD)]
    gaps += [(a["end"] + GUARD, b["start"] - GUARD) for a,b in zip(words,words[1:])
        if b["start"]-a["end"] >= .30]
    gaps.append((words[-1]["end"] + TAIL_GUARD, total/FPS))
    result = []
    for start,end in gaps:
        a,b = frame_bounds(max(0,start), min(total/FPS,end))
        if b-a < 3:
            continue
        transitions = np.diff(np.r_[False, quiet[a:b], False].astype(int))
        runs = zip(np.flatnonzero(transitions==1),np.flatnonzero(transitions==-1))
        x,y=max(runs, default=(0,0), key=lambda run:run[1]-run[0])
        if y-x >= 3:
            result.append({"start":a+int(x),"end":a+int(y),
                "reason":"词界之外且波形持续安静","type":"quiet"})
    return result


def make_clips(cuts, total):
    intervals = []
    for cut in sorted(cuts, key=lambda c: (c["start"],c["end"])):
        a,b = cut["start"],cut["end"]
        if intervals and intervals[-1][1] >= a:
            intervals[-1][1] = max(intervals[-1][1],b)
        else:
            intervals.append([a,b])
    clips, cursor, previous = [], 0, 0
    for start,end in intervals + [[total,total]]:
        if start > previous:
            clips.append({"from":cursor,"sourceFrame":previous,"length":start-previous})
            cursor += start-previous
        previous = end
    if not cursor:
        raise ValueError("No media remains")
    return clips, cursor


def map_words(words, clips, cuts):
    removed = {i for cut in cuts if cut["type"]=="retake" for i in range(*cut["removeWords"])}
    mapped = []
    for i,w in enumerate(words):
        if i in removed:
            continue
        clip = next((c for c in clips if c["sourceFrame"]/FPS <= w["start"]+0.0001 and
            (c["sourceFrame"]+c["length"])/FPS >= w["end"]-0.0001), None)
        if not clip:
            raise ValueError(f"Cut intersects retained word {w['id']}")
        offset=(clip["from"]-clip["sourceFrame"])/FPS
        mapped.append({**w, "start":w["start"]+offset,"end":w["end"]+offset})
    return mapped


def build_captions(words, display_patches=()):
    edits={p["from"]:p for p in display_patches}
    tokens, i = [], 0
    while i < len(words):
        current=words[i]
        patch=edits.pop(current["id"],None)
        if patch:
            count=patch["to"]-patch["from"]
            section=words[i:i+count]
            if count < 1 or [w["id"] for w in section]!=list(range(patch["from"],patch["to"])) or \
                "".join(w["text"] for w in section)!=patch["original"] or not patch["text"].strip():
                raise ValueError("Caption correction does not match retained source words")
            tokens.append({**current,"text":patch["text"],"end":section[-1]["end"]})
            i+=count
        else:
            tokens.append(current)
            i+=1
    if edits:
        raise ValueError("Caption correction targets missing source words")
    result, current = [], []
    def add():
        if current:
            a, b = round(current[0]["start"]*FPS), round(current[-1]["end"]*FPS)
            if b>a:
                result.append({"from":a,"length":b-a,"text":"".join(w["text"] for w in current)})
    for token in tokens:
        if current and (len("".join(w["text"] for w in current)+token["text"]) > 18 or
            token["start"] - current[-1]["end"] > .40):
            add()
            current=[]
        current.append(token)
        if token["text"][-1:] in "。，！？；、,.!?":
            add()
            current=[]
    add()
    return result


def pcm_write(output, data):
    with wave.open(str(output),"wb") as writer:
        writer.setnchannels(data.shape[1])
        writer.setsampwidth(2)
        writer.setframerate(SAMPLE_RATE)
        writer.writeframes(np.rint(data*32768).clip(-32768,32767).astype("<i2").tobytes())


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source",type=Path)
    parser.add_argument("transcript",type=Path)
    parser.add_argument("decisions",type=Path)
    parser.add_argument("output",type=Path)
    args=parser.parse_args()
    started=time.perf_counter()
    source=args.source.resolve(strict=True)
    transcript=json.loads(args.transcript.read_text(encoding="utf-8"))
    reviewed=json.loads(args.decisions.read_text(encoding="utf-8"))
    fingerprint=sha256(source)
    if transcript["sourceSha256"]!=fingerprint or reviewed["sourceSha256"]!=fingerprint or \
        reviewed["transcriptSha256"]!=sha256(args.transcript):
        raise ValueError("Transcript or decisions refer to a different source revision")
    words=transcript["words"]
    public=args.output/"public"
    public.mkdir(parents=True,exist_ok=True)
    rawAudio=args.output/"source-audio.wav"
    proxy=public/"source.mp4"
    tempAudio=args.output/".source-audio.wav"
    ffmpeg=["ffmpeg","-nostdin","-v","error","-y","-i",str(source)]
    # Both renders use the normalized source picture, with no edit baked in.
    metadata=args.output/"source-cache.json"
    identity={"sourceSha256":fingerprint,"fps":FPS,"sampleRate":SAMPLE_RATE,"size":[720,1280]}
    if not (metadata.exists() and json.loads(metadata.read_text())==identity and rawAudio.exists() and proxy.exists()):
        tempProxy=public/".source.mp4"
        subprocess.run([*ffmpeg,"-map","0:v:0","-vf","fps=30,scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1",
            "-an","-c:v","libx264","-preset","veryfast","-pix_fmt","yuv420p",str(tempProxy),
            "-map","0:a:0","-ac","2","-ar",str(SAMPLE_RATE),"-c:a","pcm_s16le",str(tempAudio)],check=True)
        tempProxy.replace(proxy)
        tempAudio.replace(rawAudio)
        save_json(metadata,identity)
    video_frames=int(subprocess.check_output(["ffprobe","-v","error","-select_streams","v:0","-show_entries",
        "stream=nb_frames","-of","csv=p=0",str(proxy)],text=True).strip())
    with wave.open(str(rawAudio),"rb") as f:
        data=np.frombuffer(f.readframes(f.getnframes()),"<i2").reshape(-1,2).astype(np.float64)/32768
    if len(data) < video_frames*FRAME:
        data=np.pad(data,((0,video_frames*FRAME-len(data)),(0,0)))
    frames=data[:video_frames*FRAME].reshape(video_frames,FRAME,data.shape[1])
    rms=np.sqrt(np.mean(frames*frames, axis=(1,2)))
    peak=np.max(np.abs(frames), axis=(1,2))
    cuts,held=retakes(words,reviewed.get("retakes",[]),video_frames,rms)
    cuts+=quiet_cuts(peak,rms,words,video_frames)
    clips,total=make_clips(cuts,video_frames)
    retained=map_words(words,clips,cuts)
    capsules=[]
    for clip in clips:
        a=clip["sourceFrame"]*FRAME
        n=clip["length"]*FRAME
        region=data[a:a+n].copy()
        ramp=min(384,n//2)
        region[:ramp]*=np.linspace(0,1,ramp)[:,None]
        region[-ramp:]*=np.linspace(1,0,ramp)[:,None]
        capsules.append(region)
    dry=np.concatenate(capsules)
    voice,proof=clean_audio(dry,SAMPLE_RATE,[w for w in retained if not w.get("unaligned")],
        [w for w in retained if w.get("unaligned")])
    pcm_write(args.output/"dry-voice.wav",dry)
    pcm_write(public/"voice.wav",voice)
    del proof["frames"]
    save_json(args.output/"audio-proof.json",proof)
    cues=[]
    for cue in reviewed.get("cues",[]):
        word=next((w for w in retained if w["id"]==cue["word"]),None)
        if not word:
            raise ValueError("Cue points to a removed or missing word")
        start=round(word["start"]*FPS)
        length=min(round(cue["seconds"]*FPS),total-start)
        if length<=0:
            raise ValueError("Cue duration must be positive")
        if any(start < other["from"]+other["length"] and other["from"] < start+length for other in cues):
            raise ValueError("Cues overlap")
        cues.append({**cue,"from":start,"length":length})
    save_json(args.output/"timeline.json",{"fps":FPS,"frames":total,"sourceSha256":fingerprint,
        "clips":clips,"captions":build_captions(retained,reviewed.get("captionCorrections",[])),
        "cues":cues,"title":reviewed.get("title",""),"description":reviewed.get("description",""),
        "cuts":cuts,"unresolved":reviewed.get("unresolved",[])+held,
        "timing":{"analyzeSeconds":transcript["seconds"],"prepareSeconds":round(time.perf_counter()-started,3)}})
    print(f"{total/FPS:.2f}s; {len([c for c in cuts if c['type']=='retake'])} retakes; {len(proof['gapEvents'])} attenuation events")


if __name__=="__main__":
    main()

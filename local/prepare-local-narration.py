#!/usr/bin/env python3
"""Prepare offline narration, aligned Remotion captions, and a 30 fps scene clock."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

FPS = 30
SAMPLE_RATE = 48_000
SAMPLES_PER_FRAME = SAMPLE_RATE // FPS


def characters(text):
    return "".join(char.lower() for char in text if char.isalnum())


def caption_pages(text, aligned, from_frame, audio_seconds):
    aligned_text = "".join(characters(item.text) for item in aligned)
    if aligned_text != characters(text):
        raise ValueError("强制对齐文本与定稿不一致，请检查当前段")
    spans = []
    for item in aligned:
        count = len(characters(item.text))
        if count:
            start = max(0.0, min(audio_seconds, item.start_time))
            end = max(start, min(audio_seconds, item.end_time))
            for index in range(count):
                spans.append((start + (end - start) * index / count,
                              start + (end - start) * (index + 1) / count))

    tokens, pages = [], []
    cursor = 0
    for match in re.finditer(r"[A-Za-z0-9]+|[\u3400-\u9fff]|[^\s]", text):
        value = match.group()
        count = len(characters(value))
        if not count:
            if tokens:
                tokens[-1]["text"] += value
            continue
        start = round((from_frame / FPS + spans[cursor][0]) * 1000)
        end = round((from_frame / FPS + spans[cursor + count - 1][1]) * 1000)
        cursor += count
        if match.start() and text[match.start() - 1].isspace() and tokens:
            value = " " + value
        tokens.append({"text": value, "startMs": start, "endMs": max(start + 1, end),
                       "timestampMs": None, "confidence": None})

    page = []
    for token in tokens:
        if page and sum(len(row["text"]) for row in page) + len(token["text"]) > 19:
            pages.append(page)
            page = []
        page.append(token)
        if token["text"][-1] in "。！？!?" or (token["text"][-1] in "，、" and len(page) >= 6):
            pages.append(page)
            page = []
    if page:
        pages.append(page)
    for page in pages:
        for current, following in zip(page, page[1:]):
            current["endMs"] = max(current["startMs"] + 1, following["startMs"])
    return pages


def main():
    voice_home = Path(os.environ.get("XIAOPENG_LOCAL_VOICE_HOME", Path.home() / "Applications/Qwen3-TTS-Local"))
    aligner_home = Path(os.environ.get("XIAOPENG_LOCAL_ALIGNER",
                       Path.home() / ".local/share/pengchen-web/runtime/aligner"))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("script", type=Path, help="UTF-8 精简稿，每个非空行是一段")
    parser.add_argument("out", type=Path, help="本片声音工作目录")
    parser.add_argument("--tempo", type=float, default=1.15, help="保音高的后期倍速")
    args = parser.parse_args()
    if not 0.5 <= args.tempo <= 2.0:
        parser.error("语速倍率必须在 0.5 与 2 之间")
    lines = [line.strip() for line in args.script.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not lines or not all(characters(line) for line in lines):
        parser.error("每个非空行都要含有可朗读内容")
    profile_path = voice_home / "default-voice.json"
    if not profile_path.is_file() or not aligner_home.is_dir():
        parser.error("找不到已配置的本地默认音色或强制对齐模型")
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    reference = voice_home / profile["reference"]
    speaker = voice_home / profile["speaker_reference"]
    for file, key in [(reference, "reference_sha256"), (speaker, "speaker_reference_sha256")]:
        if hashlib.sha256(file.read_bytes()).hexdigest() != profile[key]:
            raise ValueError("本地默认音色录音与已核验的配置不一致")

    os.environ.update(HF_HUB_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", TRANSFORMERS_VERBOSITY="error")
    import mlx.core as mx
    import numpy as np
    import soundfile as sf
    from mlx_audio.stt.utils import load_model as load_aligner
    from mlx_audio.tts.utils import load_model as load_voice

    started = time.monotonic()
    mx.set_default_device(mx.gpu)
    model = load_voice(profile["model_path"])
    clip, sr = sf.read(speaker, dtype="float32")
    if sr != 24_000 or clip.ndim != 1 or not np.isfinite(clip).all() or np.max(np.abs(clip), initial=0) < .001:
        raise ValueError("默认音色参考需要是有效的 24 kHz 单声道录音")
    embedding = model.extract_speaker_embedding(mx.array(clip))
    mx.eval(embedding)
    object.__setattr__(model, "extract_speaker_embedding", lambda audio, sr=24000: embedding)
    voice_ready = time.monotonic()
    args.out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=args.out, prefix="叙述-") as tmp:
        work = Path(tmp)
        generation = []
        for index, line in enumerate(lines, 1):
            start = time.monotonic()
            mx.random.seed(61)
            samples = []
            for result in model.generate(text=line, ref_audio=str(reference), ref_text=profile["ref_text"],
                                         lang_code="Chinese", temperature=.65, top_k=profile["top_k"],
                                         top_p=profile["top_p"], repetition_penalty=profile["repetition_penalty"],
                                         max_tokens=1200, verbose=False, stream=False):
                if result.token_count >= 1200:
                    raise ValueError(f"第 {index} 段过长，请拆成更短的段落")
                samples.append(np.asarray(result.audio, dtype=np.float32).reshape(-1))
            data = np.concatenate(samples) if samples else np.empty(0)
            peak = float(np.max(np.abs(data), initial=0))
            if peak < .001 or not np.isfinite(data).all():
                raise ValueError(f"第 {index} 段未生成有效音频")
            rms = float(np.sqrt(np.mean(data ** 2)))
            data *= min(profile["output_rms_target"] / rms, profile["output_peak_ceiling"] / peak)
            raw = work / "raw.wav"
            sf.write(raw, data, model.sample_rate, subtype="PCM_16")
            subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(raw),
                            "-af", f"atempo={args.tempo}", "-ar", str(SAMPLE_RATE), "-ac", "1",
                            "-c:a", "pcm_s16le", str(work / f"{index}.wav")], check=True)
            generation.append(round(time.monotonic() - start, 3))
        del model
        del embedding
        mx.clear_cache()
        alignment_start = time.monotonic()
        aligner = load_aligner(str(aligner_home), model_type="qwen3_forced_aligner")
        aligner_ready = time.monotonic()
        combined, captions, scenes = [], [], []
        frame = 0
        for index, line in enumerate(lines, 1):
            source = work / f"{index}.wav"
            data, _ = sf.read(source, dtype="int16")
            words = aligner.generate(audio=str(source), text=line, language="Chinese").items
            try:
                pages = caption_pages(line, words, frame, len(data) / SAMPLE_RATE)
            except ValueError as error:
                raise ValueError(f"第 {index} 段：{error}") from error
            length = math.ceil(len(data) / SAMPLES_PER_FRAME) + 8
            scenes.append({"text": line, "start": frame, "length": length,
                           "tokens": [token for page in pages for token in page]})
            captions.extend(pages)
            combined.append(np.pad(data, (0, length * SAMPLES_PER_FRAME - len(data))))
            frame += length
        sf.write(args.out / "旁白.wav", np.concatenate(combined), SAMPLE_RATE, subtype="PCM_16")
        (args.out / "字幕页.json").write_text(json.dumps(captions, ensure_ascii=False, indent=2), encoding="utf-8")
        (args.out / "时间线.json").write_text(json.dumps({"fps": FPS, "frames": frame, "scenes": scenes},
            ensure_ascii=False, indent=2), encoding="utf-8")
    elapsed = time.monotonic() - started
    report = {"frames": frame, "duration": frame / FPS, "tempo": args.tempo,
              "modelSeconds": round(voice_ready - started, 3), "ttsBySegmentSeconds": generation,
              "alignerSeconds": round(aligner_ready - alignment_start, 3),
              "alignmentAndAssembleSeconds": round(time.monotonic() - aligner_ready, 3),
              "totalSeconds": round(elapsed, 3)}
    (args.out / "语音耗时.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()

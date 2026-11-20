"""Create a word-timed transcript from local media using an installed Whisper model."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unicodedata

VERSION = 1


def sha256(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def save_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def transcribe(audio, backend, model, aligner=None):
    if backend == "qwen":
        import re
        from mlx_audio.stt.utils import load_model
        import numpy as np
        import wave
        with wave.open(str(audio)) as wav:
            samples = np.frombuffer(wav.readframes(wav.getnframes()), np.int16).astype(np.float32) / 32768
        text = load_model(str(model)).generate(
            samples, language="Chinese", max_tokens=2048, temperature=0,
        ).text
        aligned = load_model(str(aligner), model_type="qwen3_forced_aligner").generate(
            audio=str(audio), text=text, language="Chinese",
        )
        units = [{
            "word": item.text, "start": item.start_time, "end": item.end_time,
        } for item in aligned.items]
        clauses, cursor = [], 0
        for clause in re.findall(r"[\u4e00-\u9fffA-Za-z0-9]+(?:[，。！？；、,.!?])?", text):
            expected = re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", clause)
            selected, size = [], 0
            while size < len(expected) and cursor < len(units):
                word = units[cursor]
                cursor += 1
                size += len(word["word"])
                selected.append(word)
            if not selected or "".join(w["word"] for w in selected) != expected:
                raise ValueError("Forced-alignment text differs from transcript")
            selected[-1]["word"] += clause[len(expected):]
            clauses.append({"words": selected})
        if cursor != len(units):
            raise ValueError("Forced-alignment output has extra words")
        return clauses
    if backend == "mlx":
        import mlx_whisper
        return mlx_whisper.transcribe(
            str(audio), path_or_hf_repo=str(model), language="zh", word_timestamps=True,
            condition_on_previous_text=False, temperature=0, verbose=None,
            initial_prompt="以下是简体中文口播，请保留重复、错起句、否定和语气词。",
        )["segments"]
    from faster_whisper import WhisperModel
    worker = WhisperModel(str(model), device="cpu", compute_type="int8", local_files_only=True)
    rows, _ = worker.transcribe(str(audio), language="zh", word_timestamps=True,
        condition_on_previous_text=False, temperature=0, beam_size=5,
        initial_prompt="以下是简体中文口播，请保留重复、错起句、否定和语气词。")
    return [row._asdict() if hasattr(row, "_asdict") else vars(row) for row in rows]


def normalize(rows, seconds):
    words, segments = [], []
    for raw in rows:
        start = len(words)
        pending = ""
        for raw_word in raw.get("words") or []:
            word = raw_word if isinstance(raw_word, dict) else vars(raw_word)
            text = unicodedata.normalize("NFC", word["word"]).strip()
            s, e = max(0, float(word["start"])), min(seconds, float(word["end"]))
            if not text:
                continue
            if e <= s:
                if len(words) > start:
                    words[-1]["text"] += text
                    if not all(unicodedata.category(c).startswith("P") for c in text):
                        words[-1]["unaligned"] = True
                else:
                    pending += text
                continue
            if words and s < words[-1]["end"] - 0.001:
                raise ValueError("Word timing overlaps; review the local transcript")
            words.append({"id": len(words), "start": s, "end": e, "text": pending + text,
                          **({"unaligned": True} if pending else {})})
            pending = ""
        if pending:
            raise ValueError("A full group lacks aligned timing; review the local transcript")
        if len(words) == start and raw.get("text", "").strip():
            # An unaligned source range must survive and gets no automatic edits.
            s, e = max(0, float(raw["start"])), min(seconds, float(raw["end"]))
            if e <= s or (words and s < words[-1]["end"] - 0.001):
                raise ValueError("Unaligned transcript range overlaps; review the transcript")
            words.append({"id": len(words), "start": s, "end": e, "text": raw["text"].strip(), "unaligned": True})
        if len(words) > start:
            segments.append({"from": start, "to": len(words), "text": "".join(w["text"] for w in words[start:])})
    if not words:
        raise ValueError("No speech found in the source")
    return words, segments


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--backend", choices=["mlx", "faster-whisper", "qwen"], required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--aligner", type=Path)
    parser.add_argument("--force", action="store_true")
    options = parser.parse_args()
    source = options.source.resolve(strict=True)
    model = options.model.resolve(strict=True)
    if not model.is_dir():
        parser.error("pass an installed local model directory")
    started = time.perf_counter()
    fingerprint = sha256(source)
    if options.backend == "qwen" and not options.aligner:
        parser.error("--aligner is required for qwen")
    def files(directory):
        return {file.name: [file.stat().st_size, file.stat().st_mtime_ns]
            for file in sorted(directory.iterdir()) if file.is_file()}
    aligner = options.aligner.resolve(strict=True) if options.aligner else None
    identity = {"version": VERSION, "sourceSha256": fingerprint, "backend": options.backend, "model": str(model), "modelFiles": files(model)}
    if aligner:
        identity.update(aligner=str(aligner), alignerFiles=files(aligner))
    if options.output.is_file() and not options.force:
        saved = json.loads(options.output.read_text(encoding="utf-8"))
        if all(saved.get(key) == value for key, value in identity.items()):
            print("Reused local transcript")
            return
    options.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="local-asr-") as temporary:
        import wave
        audio = Path(temporary) / "speech.wav"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(source), "-map", "0:a:0",
            "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(audio)], check=True)
        with wave.open(str(audio)) as input_audio:
            seconds = input_audio.getnframes() / input_audio.getframerate()
        rows = transcribe(audio, options.backend, model, aligner)
    words, segments = normalize(rows, seconds)
    save_json(options.output, {**identity, "source": source.name, "duration": seconds,
        "words": words, "segments": segments, "seconds": round(time.perf_counter() - started, 3)})
    print(f"{len(words)} tokens; {time.perf_counter() - started:.2f}s")


if __name__ == "__main__":
    main()

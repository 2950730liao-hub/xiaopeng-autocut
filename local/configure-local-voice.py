#!/usr/bin/env python3
"""Create a private default voice profile from local reference recordings."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import uuid
import wave


def prepare_recording(source, destination):
    subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", str(source),
         "-vn", "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", str(destination)],
        check=True,
    )
    with wave.open(str(destination), "rb") as recording:
        length = recording.getnframes() / recording.getframerate()
    if not 3 <= length <= 30:
        raise ValueError(f"{source.name} 长度为 {length:.2f} 秒，需要 3–30 秒")


def main():
    home = Path(os.environ.get("XIAOPENG_LOCAL_VOICE_HOME", Path.home() / "Applications/Qwen3-TTS-Local"))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path, help="参考录音")
    parser.add_argument("transcript", type=Path, help="该段录音的逐字稿（UTF-8）")
    parser.add_argument("--speaker-reference", type=Path, help="同一人的另一段清晰录音，可选")
    parser.add_argument("--voice-home", type=Path, default=home)
    parser.add_argument("--model", type=Path, help="预下载的 MLX 模型，默认音色目录下的 models/tts")
    args = parser.parse_args()
    voice_home = args.voice_home.expanduser().resolve()
    profile = voice_home / "default-voice.json"
    if profile.exists() or profile.is_symlink():
        parser.error("已有默认音色。保留原配置，或用 --voice-home 指定一个新的音色目录。")
    model = args.model.expanduser().resolve() if args.model else voice_home / "models/tts"
    if not (model / "config.json").is_file() or not any(model.glob("*.safetensors")):
        parser.error("缺少本地合成模型，请先按安装文档下载。")
    transcript = args.transcript.expanduser().read_text(encoding="utf-8-sig").strip()
    if not transcript:
        parser.error("参考录音逐字稿为空。")
    os.umask(0o077)
    profiles = voice_home / "profiles"
    profiles.mkdir(mode=0o700, parents=True, exist_ok=True)
    folder = profiles / f"voice-{uuid.uuid4().hex[:12]}"
    with tempfile.TemporaryDirectory(dir=profiles, prefix=".configure-") as directory:
        work = Path(directory)
        clips = work / "clips"
        clips.mkdir()
        reference = clips / "reference.wav"
        speaker = clips / "speaker.wav" if args.speaker_reference else reference
        prepare_recording(args.reference.expanduser(), reference)
        if args.speaker_reference:
            prepare_recording(args.speaker_reference.expanduser(), speaker)
        config = {
            "schema_version": 1,
            "reference": str((folder / reference.name).relative_to(voice_home)),
            "speaker_reference": str((folder / speaker.name).relative_to(voice_home)),
            "reference_sha256": hashlib.sha256(reference.read_bytes()).hexdigest(),
            "speaker_reference_sha256": hashlib.sha256(speaker.read_bytes()).hexdigest(),
            "ref_text": transcript,
            "model_path": str(model.relative_to(voice_home) if model.is_relative_to(voice_home) else model),
            "top_k": 50,
            "top_p": 1.0,
            "repetition_penalty": 1.5,
            "output_rms_target": 0.1,
            "output_peak_ceiling": 0.95,
        }
        pending = work / "default-voice.json"
        pending.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        clips.rename(folder)
        try:
            os.link(pending, profile)
        except FileExistsError:
            for file in folder.iterdir():
                file.unlink()
            folder.rmdir()
            parser.error("另一个进程已配置默认音色。")
    print(f"本地音色配置已写入：{profile}")


if __name__ == "__main__":
    main()

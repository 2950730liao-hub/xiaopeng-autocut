# 在另一台 Mac 安装长稿横屏制片

这套本地克隆路线使用 Apple Silicon Mac（M 系列）。已在 arm64、macOS 15.6.1、Python 3.11 和 Chrome 环境验证。Windows、Linux 和 Intel Mac 的同音色路线未验证。首次安装需要联网下载依赖与模型。

## 1. 安装 Skill 和渲染依赖

在 [GitHub Releases](https://github.com/2950730liao-hub/xiaopeng-autocut/releases/latest) 下载带版本号的安装 ZIP，解压得到 `remotion-talking-head` 文件夹。把整个文件夹放到 `~/.codex/skills/`（如果设置了 `CODEX_HOME`，放到该目录下的 `skills/`）。升级前先备份已有目录。最终应能看到 `~/.codex/skills/remotion-talking-head/SKILL.md`。

安装 Codex、Chrome、FFmpeg/ffprobe、Node.js 22+ 和 Python 3.11。使用 Homebrew 时，可以在终端执行以下命令；已安装的项目可跳过。

```sh
brew install node python@3.11 ffmpeg
brew install --cask google-chrome
skill_dir="${CODEX_HOME:-$HOME/.codex}/skills/remotion-talking-head"
npm --prefix "$skill_dir/local" ci
npx --yes hyperframes@0.9.72 --version
```

## 2. 下载本地语音模型

安装目录使用默认位置时，Codex 可以直接找到它。模型占用数 GB 磁盘空间。下载模型后，配音推理和强制对齐在本机运行。

```sh
voice_dir="$HOME/Applications/Qwen3-TTS-Local"
mkdir -p "$voice_dir"
python3.11 -m venv "$voice_dir/.venv"
"$voice_dir/.venv/bin/python" -m pip install \
  'mlx==0.32.4' 'mlx-audio==0.5.9' 'soundfile==0.14.0' 'huggingface-hub==2.2.0'

"$voice_dir/.venv/bin/hf" download mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16 \
  --revision a6eb4f68e4b056f1215157bb696209bc82a6db48 \
  --local-dir "$voice_dir/models/tts"
"$voice_dir/.venv/bin/hf" download mlx-community/Qwen3-ForcedAligner-0.6B-8bit \
  --revision 0e1a68e91d815300c7c9754b2a7639378b23db15 \
  --local-dir "$voice_dir/models/aligner"
```

模型来源见 [Qwen3-TTS 的 MLX 模型卡](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16) 和 [MLX Audio 强制对齐示例](https://github.com/Neywa-Labs/mlx-audio/blob/main/mlx_audio/stt/models/qwen3_asr/README.md)。

## 3. 配置自己的音色

选一段约 10–20 秒的本人干声，一人说话，无配乐。保存录音里实际说的逐字稿为 UTF-8 文本。同一人的另一段干声可选，用于单独提取音色。把下面两个示例路径换成实际文件。

```sh
"$voice_dir/.venv/bin/python" "$skill_dir/local/configure-local-voice.py" \
  "$HOME/Desktop/我的录音.m4a" "$HOME/Desktop/录音逐字稿.txt"
```

如果已经有一套满意的音色，可以私下复制原 `default-voice.json`，以及其 `reference`、`speaker_reference` 指定的录音。用新 Mac 的默认音色目录保持 JSON 中的相对目录结构和原录音字节。把 JSON 中的 `model_path` 改为 `models/tts`。如两条录音记录的是绝对路径，把这两个字段改为新位置的相对路径。这样保留原参考文稿、参数和校验值。新建音色和迁移音色选其一。

选择其他音色或模型目录时，在启动 Codex 的环境设置 `XIAOPENG_LOCAL_VOICE_HOME`、`XIAOPENG_LOCAL_ALIGNER`。默认目录无需设置。录音、逐字稿和本机配置由你私下保存。

## 4. 试制并直接贴长稿

先用下面的短句验证本地音色和强制对齐。

```sh
sample_dir="$(mktemp -d)"
printf '%s\n' '你好，这是我的本地配音。' > "$sample_dir/测试稿.txt"
"$voice_dir/.venv/bin/python" "$skill_dir/local/prepare-local-narration.py" \
  "$sample_dir/测试稿.txt" "$sample_dir/音频"
open "$sample_dir/音频/旁白.wav"
node "$skill_dir/local/caption-overlay.mjs" --warmup
```

重新打开 Codex，首次使用可输入「用 `$remotion-talking-head` 把下面这篇稿直接做成横屏视频」，接着贴稿。在剪辑对话中之后可直接贴新稿。Codex 会梳理精简、按稿件设计语义动画、用你配置的本地音色配音，并以 Remotion 逐词高亮交付 **16:9 MP4 和精简稿**。见[长稿制片流程](long-script-video.md)。

首跑找不到依赖时，确认 `SKILL.md` 的安装路径、`ffmpeg -version`、`node -v` 和两个模型目录。如果模型找不到权重，检查下载是否完整。音色校验失败时，用原录音重新迁移，或另建配置。

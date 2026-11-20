# 独立本地粗剪和 Remotion

将此 Skill 目录、原片、选用的语音模型和授权素材带到目标电脑。包内包含离线去气口模块。这个入口直接调用本地程序，未启动或连接 Web 粗剪。需要 Python 3.11+、NumPy、SciPy、FFmpeg/ffprobe 和 Node.js 20+。Apple Silicon 已用 Qwen ASR、强制对齐与 MLX Whisper 验证。CPU 用 faster-whisper 加已下载的本地模型，是预留路径，需目标机验片。

## 原片到时间线

将 SKILL 指向解压或安装后的 Skill 目录。SOURCE 和 OUT 使用绝对路径，每条使用不同的 OUT。

```sh
SKILL="${CODEX_HOME:-$HOME/.codex}/skills/remotion-talking-head"
mkdir -p "$OUT"
python "$SKILL/local/analyze.py" "$SOURCE" "$OUT/transcript.json" \
  --backend qwen --model "$LOCAL_ASR_MODEL" --aligner "$LOCAL_ALIGNER"
```

`mlx` 使用 mlx-whisper 和本地模型目录，`faster-whisper` 使用 CPU 和已下载的 CTranslate2 模型目录。两者不传 aligner。先看导出的原始词、时间和分句。普通话重录验收优先 Qwen；Whisper 可能把一口气内重说自动合并，遇到歧义请把原话保留并记录。

Codex 根据这份转写生成 decisions.json，包含与转写一致的 sourceSha256、对 transcript.json 实际字节计算的 transcriptSha256、retakes、cues、title、description。retakes 每条用 from/to 绑定删除的词号区间，用 keepFrom/keepTo 绑定后一句，两个区间都含起始词、排除结束词，reason 写清为什么是重说。节目内容默认按原顺序保留。cues 使用 word（保留的词号）、seconds、text，可选 asset（public 下的图片或视频）、panel、sound。字幕校正只影响显示，使用 captionCorrections 每项的 from、to、original、text。无法证明的词、边界或素材写入 unresolved。

```sh
python "$SKILL/local/prepare.py" "$SOURCE" "$OUT/transcript.json" "$OUT/decisions.json" "$OUT"
cp "$SKILL"/local/{film.tsx,export.mjs,mux.mjs,sound-plan.mjs,package.json,package-lock.json} "$OUT/"
cd "$OUT"
npm ci
node export.mjs final.mp4
# 可选，单独导出供审核；精剪本身不依赖这份 MP4。
node export.mjs rough.mp4 rough
```

prepare 会产出未剪接的本地画面代理、准确对齐的处理人声、干声与降音回执，以及 timeline.json。同一个场景输入可用 props 在 Remotion Studio 审阅。音画剪接共享帧时钟，音频处理使用 48 kHz 样本。保留词界不允许被剪点覆盖；找不到安静边界的重录作为待核验项保留，其它段继续。本地时间线、代理和所用素材存相对路径。可选的字幕字体为 public/caption.otf；开启 sound 需放置 public/tap.wav。没有合适素材就先保留说话人主镜头。封面沿用[封面、标题和简介](publish-package.md)。

## 参考模板调整字体和关键词

先读到模板实际字体及对应的字幕、标题和关键词轨，并复核样张。保留现有剪点和台词，逐片挑少量已在口播出现的词。模板 5 的字重可用于首屏，模板 45 的白色粗黑字幕和金色粗金陵大字可用于反差、概念或结论。素材出镜或上方已占文字时可用字幕内高亮。

`local/style-timeline.mjs` 接收原 timeline.json、同源 transcript.json、keywords.json 和输出文件名。keywords.json 是数组，每项为 term、可选 mode（large 或 inline）、occurrence（第几次出现，从 1 起算）及 holdFrames。它按真实词号映射到成片帧，拒绝跨已剪段、跨字幕或重叠的词。成片同一字词只强调必要的位置。

启用此模板外观时，将可用的真实字体文件放进渲染目录的 public，正文为 caption.otf，标题为 template-title.otf，关键词为 template-accent.ttf。使用实际文件，避免链接在打包后失效。纯视觉修改可只渲染画面并复用旧 AAC，核对帧数和音轨哈希。抽查大字入场、中间和最大字号，核对人物脸部和手势是否遮挡、正文是否可读。

关键词音效与高亮取同一输出帧。用 `python3 "$SKILL/local/make-keyword-sounds.py" "$OUT/public"` 准备音效。大字用 keyword-pop.wav，行内字用 keyword-tick.wav。同帧存在段落提示音时用一次关键词音效。预览和导出共用 sound-plan.mjs，关键词入场时短暂压低口播约 120 毫秒以减少掩盖。导出后核对实际入点、音效与同一时刻口播的音量差以及成片峰值，并按同一时间段制作可试听片段。

## 模板动作、图片和进度卡

任选已核对的本地剪映参考。沿用实际口播和粗剪，只把影响理解的节点做成画面。63 号适合情感口播的人物主镜头和少量引用画面，45 号可提供字幕层级，5 号可参考开场和局部强调。每个时间点只选一个主焦点，普通字幕仍完整保留。

对已有词级绑定的时间线运行：

```sh
node "$SKILL/local/semantic-timeline.mjs" "$OUT/timeline.json" "$OUT/semantic-plan.json" "$OUT/semantic-timeline.json"
```

计划是数组，每项通过 `anchor: {word: 44}` 选一个既有 cue，或通过 `anchor: {term: "挡在前面"}` 选一个唯一的既有强调词。用 `kind: "card"` 设置 `step` 和 `total`，总览用第 0 步。动作用 `kind: "action"` 和 `motion: "shield" | "push" | "reveal"`。图片用 `kind: "image"`，复用已核对的 cue 图片与裁块。按实际人物位置选 `side: "left" | "right"`，加必要的 `text` 和 `holdFrames`。对于画面承担不了证据的材料标出情境示意，记录来源。计划只读原时间线，消除同一焦点窗口内的重复强调。

每条语义画面可指定一个已核对的 `soundFile`，将有清晰起音、已修剪头尾的短 WAV 放进 public。章节、动作和镜头的音色分别选。导出器在实际落点测量约 120 毫秒的人声和音效，自动给出有限幅的增益，生成的 render props 可给 Studio 复用。保留配乐设置；无配乐项目只混人声和事件音效。

在独立渲染目录把语义版本作为 `timeline.json`，用 `node export.mjs semantic-preview.mp4 final 244:691` 渲染短样。区间为成片帧，包含起帧，结束帧不含。A 版从同一时间区间截取。用短样核对主焦点、人物遮挡、音效可辨识度和字幕，再成批渲染。只改音效时可用 `mux.mjs` 复用已有画面。

## 批次和计时

可并行准备两份转写并分别保存，确认语义后按片编译。每片独立渲染目录，先用 3 份实际渲染并行测试。记录从源到转写、首次生成代理、复用代理重做、Remotion 画面渲染、混音与完整解码，另记 Codex 选句和验片。成片复核漏剪、误剪、音画边界和气口；报告中区分离线技术检查和人工试听。移动到第二台电脑后重新核对效果和运行时间。

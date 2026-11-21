# 三种视频流程

从真人原片执行 [独立粗剪](local-pipeline.md)，也可复用同源、已核验的剪辑目录。文案任务先让 Codex 拆分镜和匹配画面，按文案原意逐段指定标题、素材、动作和重点词。一个时间点只设一个主焦点。有没有素材只影响分镜使用的画面，配音、字幕和画面依同一成片时间同步。

贴长稿直接做横屏视频时，使用[长稿制片入口](long-script-video.md)和本地音色流程。下面的通用接口适用于其余模式和明确选择第三方配音或字幕的任务。

## 运行

```sh
node "$SKILL/local/create-video.mjs" talk talk.json "$OUT"
node "$SKILL/local/create-video.mjs" script script.json "$OUT"
node "$SKILL/local/create-video.mjs" montage montage.json "$OUT"
node "$SKILL/local/create-video.mjs" script article.json "$VOICE_OUT" --voice-sample
node "$SKILL/local/batch-video.mjs" batch.json "$OUT"
```

每条任务使用新目录。需要 Node.js 22+、FFmpeg/ffprobe 和 libass。安装 `local/package-lock.json` 锁定的 Remotion 依赖，也可用 `XIAOPENG_REMOTION_MODULES` 指向已准备的 node_modules。HyperFrames 默认调用已固定版本的 CLI，可通过 `XIAOPENG_HYPERFRAMES_BIN` 指定已安装的同版本程序。可分别通过 `XIAOPENG_CHROME`、`HYPERFRAMES_BROWSER_PATH` 指向已安装的浏览器。GSAP 默认使用固定版本，也可用 `XIAOPENG_GSAP_FILE` 指向本地脚本。

- 真人口播传 `{ "project": "./已完成粗剪的目录" }`，其中有 timeline.json、public/voice.wav、source.mp4 及本 Skill 的 Remotion 导出入口。该入口使用原声。
- 两个文案入口传 `script`、ElevenLabs 的 `voiceId` 及可选 `voiceModel`。通过环境配置 `ELEVENLABS_API_KEY`。TTS 请求只发送要读的定稿及声音设置。使用相同 `XIAOPENG_VOICE_CACHE` 可复用同稿同音色；缓存含原文和音频。
- 配音生成后以实际音频长度和 ElevenLabs 字时间为准。Codex 可传 `scenes`，每段的 `text` 必须保留原文，另传简短 `title`、`highlights` 和可选 `motion`。传 `{ "kind": "progress", "step": 2, "total": 3, "label": "固定开支" }` 渲染 Remotion 卡片。动作和数字用 `action`、`number` 和自己的 `label`。
- 混剪传 `materials: [{ "id": "ledger", "file": "./账本.png" }]`，在对应 `scenes` 上设置 `material: "ledger"`。视频可另设源片秒数 `trim`，去掉素材原音，短素材保持最后一帧。纯文案可直接用图文场景，也可以把已获得的库素材或生成素材填到 `sceneAssets`。本入口使用已有素材文件，素材搜索或生成由 Codex 或外部工具先完成。

## 横屏与声音

教学任务用 `format: "16:9"`。预览 1280×720，正式版 1920×1080，均为 30 fps。省略 format 时沿用原竖屏。实操类场景可用 `demo` 传 `id, request, status, detail, focus`，加可选 `evidence, approval, result`。同一案例沿用 id，focus 依次可取 request、evidence、approval 或 result。前后对比用 `compare: { before, after, basis }`。数值图解用 `data: { label, before, after, unit, detail }`，before 和 after 提供同单位数值。示意画面明确标注；数据缺失时可以做定性对比。

新音色用 `sampleText` 指定包含缩写和数字的短摘录，执行 `--voice-sample` 只生成真实 ElevenLabs 语音，无需视频或字幕。听清楚术语后再跑整条。同一批复用选择和缓存。

`audio.music` 可传 `{ "file": "./bed.wav", "gain": 0.14 }`。`audio.effects` 用 `{ "scene": 2, "anchor": "查到规则", "file": "./confirm.wav" }` 跟随实际词时间，也可直接用 `frame`。配乐随旁白自动让位，只在关键动作加短音效。真人口播默认不选批次配乐。将 `audio.music` 设为 `null` 可取消批次分配的配乐。

## 语义开场与关键动作

先从这条定稿提取一个观众需要看懂的问题、一个看得见的对象，以及能证明变化的动作。优先选实际素材或已有记录，示意画面注明「教学模拟」。定稿没有实测数值时，使用空白基线、定性状态或清楚标注的示意。

- **开场**：首帧建立语境，通常在前 1–3 秒让观众看到一次与开场问题有关的变化。可以是先闪现结果、暴露旧流程的卡点、展开实物关系或显出某项缺失。前置结果时，首屏文案说明它与后续讲解的关系，并回看开头两句是否接得上。
- **关键动作**：为需要解释的关键转折记录台词锚点、输出帧、动作前后状态、焦点和证据来源。每拍只突出一个变化，镜头跟对象或因果走。只有同一对象确实贯穿时，才延续其标识。动词优先展示操作或过程，具体名词用对应素材，数字用有来源的信息卡。音效与动作落稳对齐。
- **按语义选画面**：系统写回可以串起请求、证据和结果；表格盘点可以展示反复切页、条件筛选和行归并；效率试点可以从缺失的计时基线切到选择一个流程与复盘决策。记录每条样片的开场与关键动作，各条随定稿重新选。
- **执行与复核**：通用分镜继续走现有 `story`、素材与 `motion`。连续动作需要专属布局时，按已经对齐的帧钟独立制作 HyperFrames 镜头，Remotion 处理字幕和需要逐帧同步的强调。局部返修复用未变化的画面与音轨，对齐仍有效时复用字幕或字幕字时间。首件抽看首个变化、关键锚点和结果，检查字幕是否挡住焦点。批量分别记录分镜设计、准备与等待、画面、字幕、音轨处理、合成和核验，用批次墙钟报告并行总耗时，注明所有复用阶段。

## 连续操作镜头

文案确实包含查询、依据、确认和写回四个动作时，可为一个 `scenes` 段传 `workflow`。以退款示例来说，HyperFrames 用工作台展示请求，推向规则原文，再回到原工单。Remotion 绘制连线和条款标记，切换确认、写回中及已写回状态，并保留同一记录编号。流程示意标记为教学模拟。真实项目截图先核对来源。首件抽查点击前、命中条款、写回后三个状态。

```json
{
  "id": "CS-1042",
  "heading": "Agent 接进真实业务",
  "subject": "退款申请",
  "request": "买了五天，商品还没拆封。能申请退货吗？",
  "source": "售后知识库 / 退货规则",
  "clauses": ["签收后七天内", "商品未拆封"],
  "result": "处理记录已写回",
  "anchors": {
    "lookup": "查工单",
    "evidence": "读条款",
    "approve": "客服确认",
    "write": "把记录写回"
  }
}
```

四个锚点按配音字时间定位，必须出现在同一段台词中，顺序为查询、依据、确认、写回。依据和确认之间应留足读两条短语并回镜的时间。用同一组锚点配置 `audio.effects`，点击、命中、确认、提交各用一个短声。可选 `badge`、`workspace`、`requestLabel`、`lookupLabel`、`evidenceLabel`、`note`、`action`、`savedStatus` 替换界面文案。

其余段落用 `story: { layout, kicker, items: [{label, detail}, ...] }`，配 `title` 和 `look: "editorial"`。开题或结尾用 `lead`，讲先后用 `path`，展示记录或原始依据用 `evidence`，讲验收条件用 `check`。每段用两至三条实际可读的内容。演示阶段只为变化的底图帧截图，静止尾段延长最后一帧。透明动效继续按独立时间轴放到写回落稳，整体帧数、旁白长度和落点保持一致。

## 批量与返修

`batch.json` 传 `jobs: [{ "id": "fde", "mode": "script", "job": "./fde.json", "mood": "教学" }]`，可设置 `concurrency`，默认 2。需要技术预览时设 `preview: true`。曲库 `music` 的每项含 `id, file, moods, approved`，只使用明确标记 `approved: true` 的曲目；按题材匹配，避开相邻任务重复。同一批共用配音和镜头缓存，每片独立出记录，失败不会阻止其他条。预热使用独立 Chrome 临时配置。HyperFrames 优先已配置的浏览器或本机 Chrome，无可用程序时走受限时的浏览器准备。Remotion 浏览器准备与渲染使用同一个依赖根目录；每套渲染包按源码和锁定依赖签名存到 `XIAOPENG_RENDER_CACHE`（默认 `~/.cache/xiaopeng-autocut`）。并行进程共用构建锁，生成完成后才公开渲染包。设置 `concurrency: 3` 可并行三个任务而每个任务使用一个 HyperFrames worker；可通过 `XIAOPENG_HYPERFRAMES_WORKERS` 单独调整。

新配音、新模板或新画幅验首件。其余每片检查出片帧数、尺寸、音画时长、完整解码和音效计划入点。连续三幕只有换字、口播点名的字段没出现、字幕遮住证据时，只定位异常镜头；其余继续生产。申请发布是交付后的独立步骤。

按输入指纹跳过已完成的文章或混剪；局部改动仍可复用已有镜头和配音。换图只重渲相应镜头；改字幕复用画面和已混好的音轨，再合成字幕；只改配乐或音效可复用带字幕的视频轨。记录 `warmup`、`queueSeconds`、`shots.capturedFrames`、`reusedCaptionedPicture`、`reusedAudioTrack` 和阶段时间。全部成片指纹命中时跳过预热。首件如需跑 HyperFrames 布局检测，可用 `XIAOPENG_LAYOUT_INSPECT=1` 单跑该件。批次生成不同的音色、模板时按各自首件确认，沿用已核对的样式。

## Captions AI

三种入口写出 `caption-request.json`，含台词、已有字时间、重点词、帧率与尺寸。通过 `XIAOPENG_CAPTIONS_BIN` 接入已配置的 Captions AI 插件桥接程序，或用 `captionsAss` 导入制作好的 ASS 字幕。桥接程序接收 `--request 请求.json --audio 配音.wav --output 输出.ass`，按同一时间轴写出可编辑字幕，包括字体、层级和高亮。这个程序由实际插件能力决定。不要用未经确认的接口猜测字幕样式支持。无实际插件入口时，正式模式会报缺少配置。

`--preview` 可用本地基本字幕临时验版。只在预览中接受 `previewVoice: { "audio": "试听.wav", "alignment": "字时间.json", "provider": "实际配音来源" }`。回执标记实际供应方和各阶段耗时。输出完整文案样片前，先试听一段包含技术词、数字和英文缩写的旁白，并按题材抽看两个差异明显的镜头。强制对齐和解码通过用于技术验收，配音质感和画面叙事另听另看。

## 换旁白与 Remotion 字幕提速

用户指定本地个人音色时，按原稿复用已核验的个人音色配置，支持时在同一批共享模型加载和说话人嵌入。只替换旁白的返修直接使用原无字幕画面、旁白干声和原混音。优先复用保存的音乐及事件音分轨；已知旧干声与原 PCM 终混同钟、同增益并且混音未触发非线性处理时，可从终混减去旧干声提取原伴奏，再加新旁白。没有满足条件的音轨时使用独立素材按原电平、时间位置复建。新旁白按台词与现有镜头的关键锚点适配，保留原稿，以新旁白的实际时间更新字幕。记录声音来源、对齐和混音方式。

对当前 1280×720、30 fps、字幕下栏固定在 y=562 的 Remotion 高亮样式，使用字幕状态去重。输入为按行分组的 Remotion Caption JSON，每个 token 带 text、startMs 和 endMs。原字体、字重、颜色及区间高亮由 Remotion 组件保留；只截取可见文本或高亮变化的状态。FFmpeg 按原帧钟重复透明 PNG 并直接合成，省掉透明 ProRes 中间视频。带逐帧位移、缩放或特殊版式的字幕继续用对应 composition 的全帧渲染。

```sh
node "$SKILL/local/caption-overlay.mjs" --warmup
node "$SKILL/local/caption-overlay.mjs" pages.json 540 clean-720p30.mp4 mixed.wav out.mp4 timing.json
```

批处理先准备一次共享字幕渲染包，各片使用独立输出和回执。用 `XIAOPENG_REMOTION_MODULES` 与 `XIAOPENG_CHROME` 复用已配置的依赖和浏览器。逐件记录渲染包命中、启动与选 composition、状态数与原始帧数、截图、合成和批次墙钟；换旁白另记录模型加载、合成、对齐及复混。新模板首件用相同字时间和画面比对字幕状态，抽查断句、高亮和动作锚点，完成帧数、音画时长和全片解码检查。

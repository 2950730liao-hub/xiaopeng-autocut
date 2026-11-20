# Web 粗剪到 Remotion

此路径需要另行安装 `web-talking-head-rough-cut` Skill 并连接已配置的 Web 服务。也可使用本包的[独立本地入口](local-pipeline.md)。Web 引擎负责保留正确口播、压缩多余停顿、保护字头字尾并对气口杂音做包络降音、适量压制齿音。是否有气口事件以本次音频回执为准。零个事件表示未触发该处理。

## 运行与审核

1. 核实实际运行的 Web 引擎目录和地址。它可能来自本机候选发布目录，工作区不一定与运行版本相同。用 `inspect --project-root "$web_root"` 校验服务和策略；失败时报告差异。
2. 对指定原片或目录按 Web 粗剪说明执行 `start` 和 `wait`，沿用稳定请求编号。已有符合任务范围的粗剪就核验该任务。用户要求中途试听时先保留待审。用户要求从原片到成品时，可以用技术核验通过的粗剪生成 Remotion 待审精剪，Web 任务仍保留实际审核状态。
3. 在仓库根目录执行。输出目录提前建立在本地试剪工作区。

```sh
node skills/web-talking-head-rough-cut/scripts/web-rough.mjs verify \
  --project-root "$web_root" --job-id "$job_id" --remotion-handoff > "$out/rough-handoff.json"
jq -e '.handoff.captions' "$out/rough-handoff.json" > "$out/captions.json"
```

仅在核验命令成功后使用交接文件。按原片哈希、粗剪修订和指纹保存或缓存产物；粗剪返修后重新核验并丢弃上版精剪计划的时间点。缺少当前处理回执、字幕或媒体时保留断点并报告具体原因。批量逐条交接，正常条继续，阻塞条保留现状。

## 下游接法

- 用 `sourceVideo` 作为静音画面，用 `processedVoice` 作为唯一口播轨。视频文件本身含音频，画面静音可避免双轨叠加。保留 `dryVoice` 用于前后试听。
- 提示词读 `captions.json` 和 `durationSeconds`；剪点及视觉锚点使用粗剪秒数。字幕的 `startMs/endMs` 已映射到粗剪时钟。Remotion 使用同一保留区间切画面和人声，原片时间只通过 `mappingFile` 查询。
- 在成片验收前，记录 `processing.gapEvents`、齿音事件、修订及是否有人审。抽听实际触发的气口前后，留意吞字、突然抽气或切点响声。交付时分别说清处理回执、自动验证和用户试听结果。

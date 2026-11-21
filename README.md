# 小芃自动剪辑 · Xiaopeng AutoCut

供 Codex 使用的中文口播剪辑工作流。支持本地词级转写与对齐、粗剪去重和气口处理，再用 Remotion 制作字幕、语义动效、进度卡、音效和竖版封面。也支持把长稿精简成短讲，用语义动画、本地克隆配音与 Remotion 逐词高亮输出 16:9 成片。

## 安装

将本仓库克隆到 Codex 的 skills 目录。

```sh
git clone https://github.com/2950730liao-hub/xiaopeng-autocut.git "${CODEX_HOME:-$HOME/.codex}/skills/remotion-talking-head"
```

在 Codex 中使用 `$remotion-talking-head`，提供长稿，或提供原片路径、目标和素材约束。也可下载 [GitHub Releases 的安装 ZIP](https://github.com/2950730liao-hub/xiaopeng-autocut/releases/latest)，将解压后的 `remotion-talking-head` 文件夹放进同一目录。

## 本地运行

独立流程需要 Node.js 20+、Python 3.11+、FFmpeg/ffprobe、NumPy、SciPy，以及一种受支持的本地转写后端和对应模型。按 [独立本地入口](references/local-pipeline.md) 准备分析、剪辑和导出。独立流程无需连接 Web 服务，Apple Silicon 路线已实测。使用其他平台时请先跑短样。

长稿制片见[长稿直接出横屏成片](references/long-script-video.md)。首次使用或换电脑，按[新 Mac 安装与本地音色配置](references/install-on-new-mac.md)准备依赖、模型以及自己的参考录音。

仓库包含 Skill、去气口模块、Remotion 渲染脚本、封面组件和测试。原片、模型权重、专用字体、剪映授权音效及素材库需自行准备。MIT 适用于本仓库的代码和文档。Remotion 等依赖适用各自的许可。

## 测试

```sh
node --test local/*.test.mjs
python -m unittest discover -s local -p 'test_*.py'
```

[MIT 许可证](LICENSE)

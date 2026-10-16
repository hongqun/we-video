# We-Video

<p align="center">
  <img src="./public/logo.svg" alt="We-Video 标志" width="286">
</p>

![We-Video 视频创作工作台](<./We-Video%20AI%E8%A7%86%E9%A2%91%E5%88%9B%E4%BD%9C%E5%B7%A5%E4%BD%9C%E5%8F%B0.png>)

We-Video 是一个解说类视频创作工作台。它能够以低的成本（大约0.1元/分钟）高效生产视频。

We-Video把文章或资料自动转成口播稿，然后进行配音、字幕和视觉规划，最终渲染成 MP4文件。



https://github.com/user-attachments/assets/c35ecc91-e41a-4efd-b185-ddf2efff3b56



按步骤保留中间成果，便于人工检查和修改：

1. **文稿**：输入文章或资料，生成或编辑口播稿。
2. **配音**：选择音色并生成音频，审核后继续。
3. **视觉规划**：组织画面、素材和字幕节奏。
4. **预览与渲染**：在We-Video中预览成片效果，用户确认后生成 MP4文件。

## 快速开始

需要 Node.js 20 或更高版本。先安装依赖并建立本地配置：

```bash
npm ci
cp config_examples/.env.example .env
cp config_examples/pipeline.config.example.json pipeline.config.json
```

编辑 `.env`，至少填写模型 API Key、`TALK_VIDEO_ACCOUNT` 和 `TALK_VIDEO_SERIES`。账号和专题目录需按[账号配置说明](./content/README.md)放在本地配置目录中。

启动开发服务：

```bash
npm run dev
```

打开 [http://127.0.0.1:3100](http://127.0.0.1:3100)。开发服务器监听 3100 端口。

## 本地配置与数据

- `.env` 填写 API Key、账号和专题；`pipeline.config.json` 设置模型与音色。
- 账号素材放在 `data/local/content/<accountId>/`。
- 本地配置与数据不会提交到 We-Video 仓库，请勿提交 API Key。
- 账号与专题配置参见[账号配置说明](./content/README.md)；`.env` 格式参见[配置示例](./config_examples/.env.example)。

## 安装 Remotion Agent Skills

Agent Skills 可供多种编码助手使用，是开发指南而非 We-Video 的运行依赖。需要 Remotion 开发指导时，在项目根目录运行：

```bash
npx skills add remotion-dev/skills
```

按提示选择需要的 Remotion skills、目标编码助手和项目级安装方式。Skills CLI 支持多种编码助手；安装完成后按所用助手的要求重新加载 skills。更多说明见 [Remotion Agent Skills](https://github.com/remotion-dev/skills) 和 [Skills CLI 文档](https://www.skills.sh/docs/cli)。

## 项目结构

```text
content/             账号配置结构说明
config_examples/     无密钥环境变量与流水线配置示例
contracts/           文稿与渲染数据契约
data/local/content/  本地账号配置（忽略于公开仓库，独立本地 Git）
deploy/              部署脚本与服务配置
jobs/                运行时任务数据
src/app/             工作台页面与 API
src/remotion/        视频合成组件
src/server/          任务、模型和渲染服务
skills/              本地技能副本（Git 忽略）
.agents/skills/      按需安装的 Agent Skills（Git 忽略）
```

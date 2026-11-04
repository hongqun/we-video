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

## 效果示例
### 3D 模型讲解


https://github.com/user-attachments/assets/8ce4361f-9ddd-4b2c-9de7-99c0a0a18d72



## 快速开始

需要 Node.js 20 或更高版本。先安装依赖并建立本地配置：

```bash
npm ci
cp config_examples/.env.example .env
cp config_examples/pipeline.config.example.json pipeline.config.json
```

编辑 `.env`，填写登录用的 `APP_PASSWORD`、`SESSION_SECRET`；创作前再配置模型 API Key，并在 `pipeline.config.json` 中填写真实的百炼工作空间与服务连接。

默认使用内置“通用创作”，无需账号目录、专栏、Logo 或人物素材。进入工作台后点击“管理专栏”（`/profiles`），只填写名称即可保存专栏；内容定位、表达风格、声音和品牌素材均为可选。缺少模型密钥不影响进入配置界面。

启动开发服务：

```bash
npm run dev
```

打开 [http://127.0.0.1:3100](http://127.0.0.1:3100)。开发服务器监听 3100 端口。

## 本地配置与数据

- `.env` 管理认证、API Key 和部署覆盖；`pipeline.config.json` 管理模型、音色和服务连接。
- 专栏与可选品牌素材在“管理专栏”页面维护；已有账号和专题目录继续兼容。
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

## 许可

We-Video 自有代码采用 [MIT 许可](./LICENSE)，允许使用、修改、商用和闭源分发，无需另行授权；须按许可条款保留版权与许可声明。

第三方依赖及字体、图标等素材遵循各自的许可，不因本项目采用 MIT 而改变。使用 Remotion 时仍须遵守其[许可要求](https://www.remotion.dev/docs/license/pricing)。

Copyright (c) 2026 HongQun <hongqun.hq@gmail.com>

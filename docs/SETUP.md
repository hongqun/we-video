# 安装与配置

[返回项目介绍](../README.md)

所有命令均从项目根目录执行。

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
- 账号与专题配置参见[账号配置说明](../content/README.md)；`.env` 格式参见[配置示例](../config_examples/.env.example)。

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


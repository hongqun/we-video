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

## 安装自动图表 Agent 运行技能

Step 4 的“自动图表Agent”使用独立安装的 [diagram-design](https://github.com/cathrynlavery/diagram-design)。每台开发或部署机器都需从项目根目录安装；当前 Skills CLI 需要 Node.js 22.20 或更高版本：

```bash
npm ci --prefix packages/diagram-agent
npx skills add cathrynlavery/diagram-design --skill diagram-design --agent deepagents --copy --yes
```

在根目录 `pipeline.config.json` 设置 `diagramAgent.enabled=true`，并配置文本模型连接。安装目录为 `.agents/skills/diagram-design/`，已被 Git 忽略，不随代码拉取或发布自动安装。部署时执行上述命令，或将完整安装目录随运行资源一并部署；不得只复制 `SKILL.md`，还需保留 `references/`、`assets/` 等技能文件及适用的上游许可声明。

`diagramAgent.supportsVision=true` 会把复查截图发送给模型，需使用支持图像输入的模型；`diagramAgent.thinking=true` 开启 DeepSeek 思考模式。这两个字段缺省均为 `false`，新请求读取根配置生效。思考模式下 `diagramAgent.reasoningEffort` 可选 `low`、`high`、`max`，默认 `low`，用于减少制图前过度推演；该参数是思考强度偏好，不是独立的思考 token 硬额度。[DeepSeek 参数说明](https://api-docs.deepseek.com/guides/thinking_mode/)。思考和正式输出共用 `maxTokens`；默认输出额度为 32,000 token，整轮 `timeoutMs` 默认为 600,000（10分钟），两者分别限制输出与总耗时；接入层保留工具调用所需的思考字段，截图通过图像消息传递，思考内容不展示在业务对话中。

`diagramAgent.maxSaves` 控制每轮内容修改次数（含首次提交），默认 5，范围 1–10；全量保存与局部补丁共用预算，规范化后相同的内容复用上次报告且不扣保存次数。SVG 白名单、字段或补丁输入错误会以 `recoverable` 和 `errors/repairs` 返回 Agent 继续修正，拒绝的输入不会覆盖候选或扣保存次数；`pattern` 等不支持的元素应替换为安全的纯色或基础图形。失败收尾保留具体校验原因，不以模型连接或依赖安装提示覆盖。安全检查通过后，一次返回时间、语义和几何问题，修复项带稳定代码、分组 ID、文字实测边界或障碍节点坐标；连续未修复的错误会单独标出。`maxSteps` 仍限制模型与工具调用总次数，`timeoutMs` 限制整轮耗时；提高保存次数不会延长这两项预算。失败提示同时保留停止原因和当前图表的校验问题。

修复优先调用 `patch_diagram({baseHash, operations})`，支持 `replace_group`（相同 ID 的完整 `<g>`）、`update_binding`（只改指定字段）和 `remove_group`（清理绑定、依赖及无障碍引用）。过期指纹或不安全替换不会覆盖候选；`read_current_diagram({groupIds})` 可只取相关分组。候选仍须通过完整校验及 `inspect_diagram`，再由用户预览采用。

模型通过 LangChain `wrapModelCall` 在尚未收到任何流片段时，对连接、限流或服务错误最多重试一次；重试占用步数及原始超时预算，不重放已完成的工具。中断流单独报告。SDK 完成回调同时检查 `generationInfo.finish_reason` 和消息元数据；达到输出上限时以 `model_output_limit` 明确报告，并在工具执行前停止，保留已完成候选，不自动重试截断输出。类型参考和示例每页最多180行，选型最多比较两份参考，只读取最终选定图型的一份示例，优先提交首版后按校验结果修复。`session.json` 的 `diagnostics` 仅保存请求 ID、错误类别、候选指纹及预算计数，不保存凭据或 SDK 请求对象。

需显式运行回归检查时，在项目根目录执行 `npm run test:diagram-reliability`。该命令覆盖示例中的时间冲突、文字溢出、穿越箭头、包含关系清理与补丁预算，并运行本地模型替身的连接恢复、取消及复查门槛测试；几何检查使用本地浏览器和字体，不调用模型。

首次安装获取上游最新版本。需要更新时显式重跑技能安装命令，并在没有图表生成请求运行时更新；服务运行期间不会下载或更新技能。上游指导更新可能影响布局，本项目支持已安装技能文档中的 45 种主图型，并保留视频品牌、口播绑定及 SVG 安全规则。类型、中文名称、参考与静态示例统一维护在 `src/remotion/diagram-types.ts`；上游新增类型需显式加入目录，不会自动开放。

Step 4 的首次生成与对话修改均由独立 worker 只读加载此技能。技能未安装或必需资料不完整时，编辑器显示安装提示并阻止生成；现有预览与采用流程保持不变。

类型标识直接使用上游名称，例如 `flowchart`、`tree`、`loop`；不兼容旧的 `flow`、`hierarchy`、`cycle` 标识，旧图需重新生成，不自动迁移或删除数据。图表可使用区域、数据标记、独立标签和无向连接；定量图必须有上下文或用户提供的必要数值。

## 安装手绘讲解 Agent

第 4 步“手绘讲解”通过百炼生成插画，由 Remotion 原生绘制。独立运行依赖安装命令为 `npm ci --prefix packages/handdraw-agent`；自研 Skill 随包进入 Git，无需另外安装上游 Skill。Python 环境、百炼配置、使用方式和按需检查见[手绘讲解说明](HANDDRAW_EXPLAINER.md)。

## 安装 Remotion Agent Skills

Remotion Agent Skills 可供多种编码助手使用，是开发指南而非 We-Video 的运行依赖。需要 Remotion 开发指导时，在项目根目录运行：

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


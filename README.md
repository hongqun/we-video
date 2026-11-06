# We-Video

<p align="center">
  <img src="./public/logo.svg" alt="We-Video 标志" width="286">
</p>

## 关于 We-Video

**以低成本，让文章与知识成为有声有色的视频。**

不需要每月几百上千元的视频模型订阅费，不需要高超的后期制作技巧，也不需要出镜。**你只需专注内容。**

We-Video 是一个面向解说类视频的 AI 创作工作台，视频制作参考成本约 **0.1 元/分钟**。从一篇文章、一份资料出发，串联文稿、配音、字幕与画面，让知识与观点以视频的方式被看见。

![We-Video 视频创作工作台](<./We-Video%20AI%E8%A7%86%E9%A2%91%E5%88%9B%E4%BD%9C%E5%B7%A5%E4%BD%9C%E5%8F%B0.png>)

## 效果示例

https://github.com/user-attachments/assets/c35ecc91-e41a-4efd-b185-ddf2efff3b56

### 3D 模型讲解示例

https://github.com/user-attachments/assets/8ce4361f-9ddd-4b2c-9de7-99c0a0a18d72

### 手绘插画


https://github.com/user-attachments/assets/63047ef0-d178-4486-9c87-7bf7db18ae30



## 目前支持的镜头类型

- **IP 动态开场舞台**：以角色与动态舞台引出主题。
- **揭示文字**：逐步呈现核心文字，带出讲述节奏。
- **图片逐步揭示**：让配图随讲解展开，突出画面重点。
- **手绘插画**：逐笔描线、渐次上色，让插画的形成过程成为讲解的一部分。
- **3D 模型讲解**：通过环绕、特写与标注，直观呈现对象的形态与结构。
- **文字重点标注**：随讲解依次突出关键词，帮助观众抓住重点。
- **通用内容卡**：清晰呈现标题、正文与关键词，承载知识和观点。
- **关系图**：逐步展现概念之间的联系，让复杂关系更容易理解。
- **IP 动态结论舞台**：以角色与动态舞台收束内容、强调结论。

## 把精力留给内容

从资料整理到成片，视频创作往往需要反复切换工具。We-Video 将这些环节放在同一个工作台，让创作者更专注于讲什么、怎么讲。

- **从文字出发**：将文章与资料转成适合讲述的口播内容，让知识更容易被理解。
- **声音与画面协同**：配音、字幕和视觉表达围绕内容展开，丰富讲解方式。
- **创作过程可掌控**：每个阶段都可以审阅和调整，让 AI 辅助与创作者判断相互配合。
- **降低制作成本**：参考成本约 0.1 元/分钟，实际费用随模型选择、素材需求和生成次数变化。

## 从灵感到成片

**输入文章或资料 → 打磨口播稿 → 生成配音 → 编排画面 → 预览成片**

无论是知识科普、观点解读，还是专题内容，都可以从已有文字开始，逐步完成声音与画面的表达。

## 开始使用

准备好你的文章或资料，开启第一条视频的创作。

[安装与配置](./docs/SETUP.md) · [手绘插画使用说明](./docs/HANDDRAW.md) · [成片交付使用说明](./docs/DELIVERY.md) · [部署指南](./DEPLOYMENT_UBUNTU.md)

## 许可

We-Video 自有代码采用 [MIT 许可](./LICENSE)，允许使用、修改、商用和闭源分发，无需另行授权；须按许可条款保留版权与许可声明。

第三方依赖及字体、图标等素材遵循各自的许可，不因本项目采用 MIT 而改变。使用 Remotion 时仍须遵守其[许可要求](https://www.remotion.dev/docs/license/pricing)。

Copyright (c) 2026 HongQun <hongqun.hq@gmail.com>

## 自动图表 Agent

第四步选择「自动图表」后，先保存规划，再打开独立编辑弹窗。发送指令后，Agent 使用内置 diagram-design 设计流程、架构、层级、循环或时间线，并把 SVG 分组绑定到本镜头的口播。支持多轮调整、手动修改触发词与出现次数、完整图和口播预览；通过校验后再点击「采用到镜头」。关闭弹窗不取消执行，显式取消会终止 worker。

从项目根目录安装主应用及独立依赖：

```bash
npm ci
npm ci --prefix packages/diagram-agent
```

独立包使用 Deep Agents TypeScript SDK 和 SQLite checkpointer，模块格式与主项目统一为 CommonJS，避免 tsx 跨包导入共享业务代码时出现命名导出识别错误；部署需要能够加载 `better-sqlite3` 的 Node.js 环境。依赖构建失败时，准备对应 Node.js 版本的预编译包或 C/C++ 构建工具。`packages/diagram-agent/resources/` 必须随部署完整复制，不能只部署 `.next`；根目录依赖、独立包依赖、`public/fonts/`、Remotion 使用的 Chromium 和可写的任务目录也必须可用。内置资源来源与许可见 [SOURCE.md](packages/diagram-agent/SOURCE.md)。本地开发辅助 Skills 仍不进入 Git，内置 diagram-design 作为只读运行资源进入 Git。

在根目录 `pipeline.config.json` 增加：

```json
{
  "diagramAgent": {
    "enabled": true,
    "timeoutMs": 180000,
    "maxSteps": 36,
    "maxTokens": 12000,
    "supportsVision": false
  }
}
```

`model` 可选，缺省复用当前专题的文本模型；连接与密钥继续复用根配置的 `deepseek` 和根 `.env`。`maxSteps` 限制模型与工具调用总预算，`maxTokens` 限制单次模型输出；首次保存候选失败后最多自动修复两次；浏览器或字体等检查器异常会停止本轮，避免浪费 SVG 修复预算。`supportsVision` 默认 `false`；仅在所选模型与接口支持图像输入时设为 `true`，Agent 才会收到检查截图。文本模型仅接收几何报告，不视为已完成看图审核。配置缺省或 `enabled=false` 时仅关闭新图表生成，已采用图表继续渲染。现有口播、文案提取和关系图不经过此 worker。

LangSmith 同样只在根 `.env` 配置，密钥使用已有的本地配置，不写入示例或 Git：

```dotenv
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=we-video-diagram-agent
```

根 `.env` 还需设置 `LANGSMITH_API_KEY`。关闭 `LANGSMITH_TRACING` 仍可生成图表。每个请求把 `jobId`、`sceneId`、`threadId` 和 `requestId` 传入追踪元数据；弹窗显示 `diagram-request` 根 trace ID。根追踪包含 Agent 子调用、最终检查与状态回写，最终校验失败时根追踪也失败。追踪由 SDK 异步提交，追踪失败不会改变已校验的图表。上线验收时需在 LangSmith 项目中核查真实模型、工具及修复调用；本次实现未调用模型进行验收。

Agent 优先读取内置 `video-diagram-contract.md`，再读取适用的 diagram-design 类型参考与静态示例。顺序攻击链默认使用流程图；循环图需提供来自口播的 `cycleEvidence`，明确说明返回或重复关系，“环环相扣”不作为闭环证据。浏览器检查中文最小字号、越界、节点重叠及箭头终点；最后必须调用 `inspect_diagram` 复查当前版本。此检查不替代完整语义审核或人工音画预览。检查点保留历史，模型仅接收本轮工具链与最近用户要求，避免多轮重复发送旧 SVG 和场景数据。

worker 由镜头 API 按需启动，每次请求一个独立进程，不需要额外常驻服务。所有命令从项目根目录执行；不从独立包目录启动应用。`jobs/<jobId>/diagrams/<sceneId>/` 保存 `session.json`、`checkpoints.sqlite`、`current.json`、`current.svg`、`bindings.json`、`preview-<requestId>.png` 检查截图和不含模型配置的运行日志。`current.json` 是当前候选的原子事实源；不维护不可变版本库。API 不在 Next.js 请求中执行模型循环。

- `GET /api/jobs/[id]/scenes/[sceneId]/diagram`：恢复会话、读取状态、候选和校验结果。
- `POST` 同一路径：`action` 为 `send`（另传 `message`）、`retry`、`cancel`、`bindings`（另传 `bindings`）、`adopt` 或 `withdraw`。
- `visual-resources.json` 保存执行状态；`visual-plan.json` 的 `diagram` 保存已采用 SVG、绑定与上下文指纹，`previousDiagram` 仅保留上一份采用内容。
- 取消、中断、缺依赖、Skill 缺失和模型失败保留当前文件。重开或重启后可以继续对话；中断请求不会自动续跑。修改口播、边界、风格或人物布局后需要重新制图；字幕时间变化会重新计算绑定。英文派生清除中文图表的采用状态。
- SVG 使用 XML 标签、属性和本地引用白名单；浏览器检查越界、文字与节点边界和明显重叠。几何检查不是审美保证；仍需预览。触发时间是字幕区间的字符估算，不是逐字音频对齐。
- 采用、撤回和最终确认重新检查绑定及上下文；采用与撤回还检查浏览器几何。草稿允许未生成或过期图表，最终确认会阻止无效图表。Manifest 只装配 SVG 与绑定，后续渲染不读取会话、Skill 或模型。

静态检查命令为 `npx tsc --noEmit` 和 `npm run check --prefix packages/diagram-agent`。已添加 `npm run test:auto-diagram` 的安全与口播时间契约用例；浏览器几何回归可显式运行 `node --import tsx src/tests/diagram-geometry.test.ts`，模型上下文回归可运行 `packages/diagram-agent/node_modules/.bin/tsx packages/diagram-agent/src/model-context.test.ts`。依项目约定，测试、浏览器验收、模型调用和渲染需明确要求后再执行。

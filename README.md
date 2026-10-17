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

### 3D 模型预览

3D Model Scene 需要浏览器启用 WebGL。Chrome 用户可在 `chrome://settings/system` 开启“在可用时使用图形加速”，重启浏览器后在 `chrome://gpu` 确认 WebGL 已启用。受限的沙箱或托管浏览器可能无法预览 3D 模型。

在第四步选择 **3D Model Scene** 并上传 GLB 后，点击“打开三维镜头编辑器”（默认最大化，可收起右侧参数）：首尾全景关键帧自动生成，点击“开头”或“结尾”即可调整两端视角；左键旋转、右键平移、滚轮缩放，在底部时间轴定位后添加中间关键帧；“记录当前镜头”可生成进入与停留编排。关键帧支持停留、过渡时长、缓动及可选口播绑定；标注通过点击模型表面设置；暂停后拖动文字框调整位置，选中标注后拖动部件上的圆点移动锚点，释放到模型外会取消该次锚点移动。标注提供简洁标签、引线卡片、强调气泡三套预设，可调颜色、字号和引线。点击窗口内“保存修改”会直接保存镜头规划，成功后可继续编辑；点击“关闭”保留已保存内容，尚未保存的修改会在关闭前提示。

编排保存在 `visual-plan.json` 的 `modelScene` 对象中，只接受 `2.0` 相机关键帧格式，不兼容或转换旧动作编排；旧任务需要重新创建镜头规划。新编排自动生成首尾两个全景关键帧，时间固定为开头和最后一个可播放帧，两端不能删除或绑定口播；一帧镜头共用一个首尾视角。打开合法的 `2.0` 编排时会补齐缺少的边界，点击编辑器内“保存修改”后直接写入规划，关闭窗口保留已保存内容。编辑预览和导出共用 `getCameraState(frame, compiledTrack)`。替换 GLB 会重置相机与锚点，保留标注文字、标签偏移与样式供重新绑定；支持 50MB 内自包含 GLB（支持 Draco，使用本地解码器），暂不支持 Meshopt、KTX2 或外部资源。

3D 导出默认使用 `swangle` 和并发 1。可在项目 `.env` 中设置 `REMOTION_3D_GL=angle`，支持 `angle`、`egl`、`swiftshader`、`swangle`、`vulkan`、`angle-egl`；需要在实际部署环境验证所选后端。模型加载超过 45 秒会报错，导出失败日志包含实际 GL 后端。

静态检查：`npm run lint`。相机与数据契约用例：`npm run test:model-scene`。交互和导出验收应使用带纹理的真实 GLB，验证保存刷新、关键帧拖动、口播同步、加载失败及首帧/过渡/停留/末帧的预览与 MP4 对比；静态检查不能替代这些验收。

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

## 许可

We-Video 自有代码采用 [MIT 许可](./LICENSE)，允许使用、修改、商用和闭源分发，无需另行授权；须按许可条款保留版权与许可声明。

第三方依赖及字体、图标等素材遵循各自的许可，不因本项目采用 MIT 而改变。使用 Remotion 时仍须遵守其[许可要求](https://www.remotion.dev/docs/license/pricing)。

Copyright (c) 2026 HongQun <hongqun.hq@gmail.com>

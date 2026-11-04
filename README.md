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

### 手绘插画镜头

在第 4 步选择“手绘插画”，点击“查看生成提示词”：先在外部图像模型生成黑白线稿，再附上这张线稿进行上色编辑。分别上传线稿和上色图后，后台自动生成绘制计划，预览与导出均按真实线条描绘，再逐区涂色。两张图要求白底、同尺寸、构图一致；支持 10MB 以内的 PNG / JPEG / WebP，单张不超过 1600 万像素，推荐 PNG。

手绘预处理额外需要 Python 3.10+、Pillow、NumPy 和 SciPy。仅在使用该镜头时需要准备，安装命令从本项目根目录执行：

```bash
python3 -m venv .venv-handdraw
.venv-handdraw/bin/python -m pip install -r scripts/handdraw/requirements.txt
```

在根目录 `.env` 设置 `HANDDRAW_PYTHON` 为 `.venv-handdraw/bin/python` 的绝对路径；留空使用 `python3`。该设置由应用启动时读取，后台进程继承，不另建运行配置入口。

画面先整图描线，再按浅到深上色；白纸与固定画笔，无需标注部位。绘制时间最多占镜头可用窗口的 70%，成图展示至少占 30% 且不少于 1 秒。上传后按实际路径自动分配描线和上色时间：优先缩短抬笔与停顿，再加速实际绘制，整体额外加速最多 10 倍；较长镜头自然画完后保持成图。超过上限时提示所需时长和简化方向。错位、重画、复杂度过高和环境缺失会给出错误提示；中断的处理可在超时后重试。

生成提示词会按当前镜头时长给出主体、道具、独立笔画、主要颜色和色区数量的创作目标，短镜头优先只表现一个主体及必要道具。预算约束动态附加到提示词中，已有任务和专栏覆盖模板也会收到；模型出图后仍以实际路径检测为准。

上传素材和产物保存在任务内 `handdraw/`，按内容哈希隔离。替换或删除图片会使旧计划与成片失效；拆分镜头复用不可变素材，并分别校验绘制预算。首版不绑定口播部位，不生成图片、手臂、起形、擦除动画或笔声。

按需验证（不会随应用启动自动执行）：`npm run test:handdraw` 检查播放逻辑，`npm run test:handdraw:python` 检查预处理。实际画面和预览／导出一致性仍需在上传代表素材后人工检查。

预处理参考 [sweety-handdraw-video](https://github.com/threerocks/sweety-handdraw-video) 的线稿配准与线条拓扑算法；裁剪代码及 MIT 版权说明保存在 [scripts/handdraw/vendor](scripts/handdraw/vendor/LICENSE)，运行时不依赖原项目。

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

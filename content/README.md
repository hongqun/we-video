
# 账号与专栏配置

## 推荐使用方式

工作台默认使用完整的内置“通用创作”，无需创建目录、提供 Logo 或人物。打开“管理专栏”（`/profiles`），填写专栏名称即可保存，其余选填。品牌文字和 Logo 独立可选，人物图片无需命名为 `neutral`。内容定位和表达风格会参与生成，默认声音和视觉风格用于新任务。

“通用创作”内置“通用英文”翻译派生目标。打开通用创作任务后，工作区顶部显示“翻译派生：通用英文”；中文母稿成片完成后可创建独立英文任务，进入全文翻译对照与确认流程，无需另建专栏。

界面支持创建、编辑、复制、归档、上传 PNG/JPEG/WebP（最多 10MB），以及覆盖或恢复提示词。普通用户无需手动编写 JSON、提示词文件或版本号。新建专栏使用独立账号容器；复制专栏共享原账号的人物素材库，页面会提示影响范围。

新任务固定有效配置、提示词和品牌素材，之后编辑或归档专栏不会改变已有任务。旧任务首次继续生成前，会提示确认采用当前配置；历史配置无法还原。归档只影响新建选择，不删除历史资源。

## 手工配置与兼容

以下目录说明适用于已有内容库或高级手工维护。默认目录为 `data/local/content/`；未显式指定目录且旧账号仍位于 `content/` 时继续使用旧位置。

We-Video 按“账号 → 专题”读取品牌资源和创作规则。账号与专题属于各自运营者的内容资产，请放在本机账号目录，不要提交到公开仓库。

```text
data/local/content/
└── <accountId>/
    ├── account.json
    ├── brand/
    ├── ip/
    └── series/
        └── <seriesId>/
            ├── series.json
            ├── narration-system.md
            ├── narration-user.md
            ├── visual-system.md
            └── ...
```

账号目录和专题目录由你自己创建。字段校验定义在 `src/lib/profile.ts`；不要把个人品牌图片、账号介绍或未脱敏的提示词放进公开仓库。

## 本地账号仓库

首次设置时，创建本机配置目录并在其中初始化独立 Git 仓库：

```bash
mkdir -p data/local/content
git init -b main data/local/content
```

将自己的账号目录放到 `data/local/content/<accountId>/`。如需保留本地历史，可在该仓库中提交；不要为该仓库配置公开远端。

## 选择账号和专题

在项目根目录 `.env` 设置：

```dotenv
TALK_VIDEO_ACCOUNT=your-account
TALK_VIDEO_SERIES=your-series
TALK_VIDEO_PROFILES_DIR=data/local/content
```

将 `your-account` 和 `your-series` 替换为目录名。手工指定时，账号 ID 与 `account.json` 的 `id`、专题 ID 与 `series.json` 的 `id` 必须一致，只使用小写字母、数字和连字符。手工配置只需有效的 `account.json` 和专题 `series.json`；Logo 与人物配置可省略，缺失的提示词继承系统默认。

修改会影响任务解释的账号或专题配置时，递增相应的 `configVersion`。提示词和公开展示字段的完整要求以代码 Schema 与配置示例为准。浏览器只会收到经过校验的公开展示字段，不会取得密钥或本地配置路径。

## 添加专题或账号

- 添加专题：在账号目录的 `series/` 下创建新专题，填写 `series.json` 和所需提示词，再更新 `TALK_VIDEO_SERIES`。
- 添加账号：创建新的账号目录和至少一个专题，再更新 `.env` 中的账号与专题 ID。

开发、构建及部署不再强制同步品牌资源。界面上传的图片立即可预览，生成时复制到任务目录；旧项目如需恢复音乐等静态目录，可手工运行 `npm run profile:sync`。

提示词优先级为：任务快照；未固定的新任务依次读取部署覆盖目录、专栏界面覆盖、专栏文件、母专栏覆盖或文件、`content/defaults/`。只有文件不存在时才继承，空文件和读取错误会报告。部署覆盖字段会在管理页标注并限制修改。

`narration` 中旧时长、镜头数量字段保留数据兼容，不作为硬限制在界面展示。

## GLB 模型提示词

在个人专题目录 `data/local/content/<accountId>/series/<seriesId>/` 中创建 `glb-model-template.md`。工作台的“3D 模型 → 查看 GLB 提示词”会读取该模板，供复制到外部生成工具；无需先上传 GLB，也不会调用 AI 或写入镜头规划。参考图片需自行上传到外部生成工具，生成结果仍需通过工作台的 GLB 校验。

模板沿用 `promptRoots()` 的配置顺序：显式 `TALK_VIDEO_PROMPT_DIR` 覆盖目录、任务所属专题、派生专题的母专题，全部缺失时使用系统内置简化模板。任务所属专题来自 `job.json`，不使用当前环境选择的账号或专题。空文件或读取错误会报错，不会被默认模板掩盖。个人模板留在本地内容库，不提交到公开仓库。

使用 `{{NARRATION_CONTEXT}}` 放置可选上下文。界面默认附带当前镜头裁剪后的口播，可关闭；未设置占位符的自定义模板会在末尾追加上下文。系统只拼装提供的口播，不从整篇文章自动扩展内容。口播只帮助识别型号与重点部件，外观以参考图片为准；不得据此虚构内部结构或标签，图文矛盾时先请求澄清。不要将具体口播直接写死在模板中，以免绕过开关。

通用示例见 `config_examples/content/demo/series/general-science/glb-model-template.md`。输出需为不超过 50MB 的自包含普通 GLB 2.0，禁止外部资源、Draco、Meshopt、KTX2；建议模型居中、Y 向上、正面朝 +Z。

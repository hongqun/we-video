
# 账号与专题配置

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

将 `your-account` 和 `your-series` 替换为目录名。账号 ID 与 `account.json` 的 `id`、专题 ID 与 `series.json` 的 `id` 必须一致，只使用小写字母、数字和连字符。新建账号至少需要 `account.json`、品牌目录及一个专题目录；每个专题需包含有效的 `series.json` 和相应提示词。

修改会影响任务解释的账号或专题配置时，递增相应的 `configVersion`。提示词和公开展示字段的完整要求以代码 Schema 与配置示例为准。浏览器只会收到经过校验的公开展示字段，不会取得密钥或本地配置路径。

## 添加专题或账号

- 添加专题：在账号目录的 `series/` 下创建新专题，填写 `series.json` 和所需提示词，再更新 `TALK_VIDEO_SERIES`。
- 添加账号：创建新的账号目录和至少一个专题，再更新 `.env` 中的账号与专题 ID。

默认资源同步会按当前账号及专题读取 Logo、人物形象和音乐。运行开发服务或构建前，先确认所选配置和资源文件齐全。

## GLB 模型提示词

在个人专题目录 `data/local/content/<accountId>/series/<seriesId>/` 中创建 `glb-model-template.md`。工作台的“3D 模型 → 查看 GLB 提示词”会读取该模板，供复制到外部生成工具；无需先上传 GLB，也不会调用 AI 或写入镜头规划。参考图片需自行上传到外部生成工具，生成结果仍需通过工作台的 GLB 校验。

模板沿用 `promptRoots()` 的配置顺序：显式 `TALK_VIDEO_PROMPT_DIR` 覆盖目录、任务所属专题、派生专题的母专题，全部缺失时使用系统内置简化模板。任务所属专题来自 `job.json`，不使用当前环境选择的账号或专题。空文件或读取错误会报错，不会被默认模板掩盖。个人模板留在本地内容库，不提交到公开仓库。

使用 `{{NARRATION_CONTEXT}}` 放置可选上下文。界面默认附带当前镜头裁剪后的口播，可关闭；未设置占位符的自定义模板会在末尾追加上下文。系统只拼装提供的口播，不从整篇文章自动扩展内容。口播只帮助识别型号与重点部件，外观以参考图片为准；不得据此虚构内部结构或标签，图文矛盾时先请求澄清。不要将具体口播直接写死在模板中，以免绕过开关。

通用示例见 `config_examples/content/demo/series/general-science/glb-model-template.md`。输出需为不超过 50MB 的自包含普通 GLB 2.0，禁止外部资源、Draco、Meshopt、KTX2；建议模型居中、Y 向上、正面朝 +Z。

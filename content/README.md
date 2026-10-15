
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

# 通用专题示例

`demo/series/general-science/` 是可复制的通用中文知识科普专题配置示例。示例只提供专题级配置，不包含任何真实账号信息、品牌素材或个人提示词。

## 复制到本地专题库

先准备一个账号目录，并将示例专题复制到账号的 `series/` 目录：

```text
data/local/content/<accountId>/
├── account.json
├── brand/<logo-file>
├── ip/<neutral-pose-file>
└── series/general-science/
    └── series.json
```

然后在项目根目录 `.env` 中设置：

```dotenv
TALK_VIDEO_ACCOUNT=<accountId>
TALK_VIDEO_SERIES=general-science
TALK_VIDEO_PROFILES_DIR=data/local/content
```

账号配置、品牌 Logo 和至少一个 `neutral` 姿态素材仍需由使用者自行准备。生成流程所需的专题提示词文件也应放在专题目录中；本示例不提供行业专属提示词。

字段结构以 `src/lib/profile.ts` 中的专题 Schema 为准。

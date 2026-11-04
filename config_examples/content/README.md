# 通用专题示例

`demo/series/general-science/` 是可复制的通用中文知识科普专题配置示例。示例只提供专题级配置，不包含任何真实账号信息、品牌素材或个人提示词。首次使用推荐直接选择内置“通用创作”，或在 `/profiles` 页面创建专栏。

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

手工复制时仍需账号配置；品牌 Logo 与人物素材均可省略，人物不要求 `neutral` 姿态。生成流程缺失的提示词自动继承 `content/defaults/` 中的完整通用模板。附带可选的通用 `glb-model-template.md`，可复制到个人专题并按需调整；不配置时 GLB 提示词使用系统默认定义。

字段结构以 `src/lib/profile.ts` 中的专题 Schema 为准。

# We-Video 项目约定

- README（含各语言版本）保持简洁易读，聚焦项目介绍、核心功能、示例与使用入口；不添加琐碎细节或内部实现说明，详细配置与技术说明放到专门文档。
- 本项目为独立 Next.js + Remotion 应用；从项目根目录运行命令，不引用原仓库路径。
- 账号、专题与品牌素材维护在 content/；渲染契约维护在 contracts/；数据默认在 jobs/、draft/。
- 根目录 .env 与 pipeline.config.json 是本项目唯一运行配置入口；密钥不进入 Git。
- 项目自研并随 Agent 发布的内置 Skill 属于 Agent 源码，可以进入 Git；外部安装的通用 Agent Skills 不进入 Git。独立图表 Agent 的 diagram-design 运行依赖单独安装到 .agents/skills/diagram-design/，运行时只读加载，不内置上游源码；安装到根 skills/ 或 .agents/skills/ 的本地副本均被忽略，安装与部署说明见 docs/SETUP.md。
- 修改或新增业务代码时，在改动附近补充简洁中文注释；未明确要求时不运行服务、测试或渲染。

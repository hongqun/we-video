# We-Video 项目约定

- 本项目为独立 Next.js + Remotion 应用；从项目根目录运行命令，不引用原仓库路径。
- 账号、专题与品牌素材维护在 content/；渲染契约维护在 contracts/；数据默认在 jobs/、draft/。
- 根目录 .env 与 pipeline.config.json 是本项目唯一运行配置入口；密钥不进入 Git。
- 本地开发辅助 Agent Skills 不进入 Git；独立图表 Agent 的 diagram-design 是运行资源，完整内置于 packages/diagram-agent/resources/skills/diagram-design/，允许进入 Git，运行时只读加载；安装到 skills/ 或 .agents/skills/ 的本地副本均被忽略，安装说明见 README。
- 修改或新增业务代码时，在改动附近补充简洁中文注释；未明确要求时不运行服务、测试或渲染。

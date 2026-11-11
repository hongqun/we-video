# 外部设计技能与视频适配

diagram-design 单独安装到项目根目录的 `.agents/skills/diagram-design/`，不随本项目源码分发。安装时获取上游最新版本，后续更新由部署者显式执行；运行时不联网安装或更新。安装与部署步骤见 [安装与配置](../../docs/SETUP.md#安装自动图表-agent-运行技能)。

- 来源：https://github.com/cathrynlavery/diagram-design
- 许可：MIT；上游版权及第三方许可声明见上游仓库的 LICENSE 与 THIRD_PARTY_LICENSES.md，部署分发时应保留适用声明。

独立 worker 只将该技能只读映射到 `/skills/diagram-design/`，不加载同目录其他技能。本项目保留的 `resources/video-diagram-contract.md` 负责视频适配与参考路由，上游资源保持原样，首次生成与后续修改均读取技能入口、匹配的类型参考和静态示例。应用的视频品牌指南优先；不执行上游 HTML 动画、任意 Python、联网、CLI 或子 Agent。SVG 的导出和检查由专用保存、XML 白名单与浏览器几何工具适配，不直接运行上游依赖浏览器或 shell 的脚本。

支持类型与资料路由由 `src/remotion/diagram-types.ts` 的 45 项目录统一生成，主类型使用上游名称；上游更新不会自动扩大支持范围。

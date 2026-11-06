# 内置运行资源

`resources/skills/diagram-design/` 完整复制上游 `skills/diagram-design/`，另外保留仓库根目录的 MIT LICENSE 与 THIRD_PARTY_LICENSES.md。原始入口、references、assets 和 scripts 未改写。

- 来源：https://github.com/cathrynlavery/diagram-design
- 提交：`f24d98b05e2d7a5e68c2dedfe46e5b7173f50118`
- 许可：MIT，见内置 LICENSE；第三方内容见 THIRD_PARTY_LICENSES.md。

运行时只读映射到 `/skills/diagram-design/`。本项目新增的 `resources/video-diagram-contract.md` 负责视频适配与参考路由，上游资源保持原样，按需读取原始类型参考、示例与入口。应用的视频品牌指南优先；不执行上游 HTML 动画、任意 Python、联网、CLI 或子 Agent。SVG 的导出和检查由专用保存、XML 白名单与浏览器几何工具适配，不直接运行上游依赖浏览器或 shell 的脚本。

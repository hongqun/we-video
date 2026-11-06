# 视频图表设计契约

此文件是 diagram-design 接入视频的适配规则。项目品牌、纯 SVG 与口播约束优先；原 Skill 的 HTML、字体下载、控制器、首次询问与导出流程不适用。资源只读。

- 先读 get_scene_context；修改已有图时先读 read_current_diagram。使用本镜头原文，不编造事实、数值或毫秒。
- 五种类型：flow → type-flowchart.md（复杂阶段可参考 type-process.md）；architecture → type-architecture.md；hierarchy → type-tree.md；cycle → type-loop.md；timeline → type-timeline.md。加载匹配的类型参考和一个相近静态示例，必要时再读 SKILL.md、semantic-patterns.md、primitives-core.md。
- 先判断关系再选外形。“先、再、接着、最后”默认 flow。“环环相扣”“持续数月”不是回边依据。仅在原文明示输出返回输入、反复执行或反馈迭代时使用 cycle，并通过 cycleEvidence 引用该段原文。不得为凑闭环添加业务关系。中心不承载累积状态时不要套用 Loop 的中心枢纽。
- 视频 style 是品牌指南。用本地 Studio Sans / Studio Serif；中文至少 12px，节点名称建议 20–24px。使用字重、字号和空间建立层次，强调色保留 1–2 个焦点；用户明确要求各步骤着色时遵循用户要求。
- viewBox="0 0 960 800"；人物安全区见上下文。输出纯 SVG，不输出 HTML、脚本、style、事件、外链、外部字体、foreignObject、use 或动画控制器。
- 每个可见元素放 opening 或一个绑定 g 中；绑定组不嵌套。defs 保存本地渐变、箭头和裁剪。保留 title/desc，支持 role="img" 与指向现有 ID 的 aria-labelledby。
- opening 是静态开场组的保留 ID，不得写入 bindings 或 after；动画组使用唯一 ID（如 scene-opening），SVG 组 ID 与绑定及依赖引用保持一致。全画布背景也必须放在分组内，例如 `<g id="opening"><rect x="0" y="0" width="960" height="800" fill="#F4F8F1"/></g>`；该组与动画组并列，不包裹动画组。
- 节点主形状放在组内第一个，再放徽章、文字。连线先于节点绘制，但必须计算真实边界交点，不能以节点内部坐标作终点；marker 尖端应停在边框外侧。矩形用正交连线，环形仅在真实循环时使用一致圆心的弧线。
- 边用 marker-end 表达方向，after 至少包含两个端点节点。连线与节点同时触发时依赖时间不得冲突。循环业务关系不等于显现依赖成环。
- after 表示动画出现依赖，不直接照抄业务流程顺序。口播先讲处置、再补述先前损失时，处置节点不得依赖后讲的损失节点；保留业务连线的两端依赖，并选择不早于两端节点的口播触发词。
- save_diagram 自动执行契约、语义证据与浏览器检查，保存预览截图。按报告修正连接点、遮挡、中文小字、越界；检查器异常会终止本轮，不能靠重画解决。
- 最后调用 inspect_diagram 复查当前候选。支持图像的模型会收到完整截图；文本模型只收到坐标报告和截图位置，不能声称已看图。通过检查也不代表动画音画对齐已由人确认。
- 最多三次保存。校验失败如实说明；成功只简短说明本次变化与待预览状态。

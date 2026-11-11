# 视频图表设计契约

此文件是 diagram-design 接入视频的适配规则。项目品牌、纯 SVG 与口播约束优先；原 Skill 的 HTML、字体下载、控制器、首次询问与导出流程不适用。资源只读。

- 先读 get_scene_context；修改已有图时先读 read_current_diagram。使用本镜头原文，不编造事实、数值或毫秒。
- 首次生成和后续修改均读取 `/skills/diagram-design/SKILL.md`，遵循本视频契约对品牌、输出与工具的限制。参考文件在 `/skills/diagram-design/references/`，静态示例在 `/skills/diagram-design/assets/`。
- 支持系统提示词目录列出的 45 种主类型，标识与上游 `type-<标识>.md` 一致。模型路由、保存工具枚举与资源检查共用项目类型目录；必须加载所选类型的参考文件和静态示例，必要时再读 semantic-patterns.md、primitives-core.md。变体归属主类型，不自创新标识；flow、hierarchy、cycle 已移除，分别使用 flowchart、tree、loop。上游新增类型须显式更新项目目录。
- 先根据口播和目录确定主类型，最多比较两种候选的参考与示例，选定后开始布局并保存，不逐类遍历。定性语义接近关系使用概念区域或嵌套布局，不凭空生成散点数值。
- 先判断关系再选外形。“先、再、接着、最后”默认 flowchart。“环环相扣”“持续数月”不是回边依据。仅在原文明示输出返回输入、反复执行或反馈迭代时使用 loop，并通过 loopEvidence 引用该段原文。不得为凑闭环添加业务关系。中心不承载累积状态时不要套用 Loop 的中心枢纽。
- 视频 style 是品牌指南。用本地 Studio Sans / Studio Serif；中文至少 12px，节点名称建议 20–24px。使用字重、字号和空间建立层次，强调色保留 1–2 个焦点；用户明确要求各步骤着色时遵循用户要求。
- viewBox="0 0 960 800"；人物安全区见上下文。输出纯 SVG，不输出 HTML、脚本、style、事件、外链、外部字体、foreignObject、use 或动画控制器。
- 安全区检查包含标题、标签在内的整个动画组，不能只看容器主形状。text 的 y 是基线，顶部需要为实际字高留空间。save_diagram 失败时会返回当前候选的组边界、主形状 boundary、连线终点和 safeArea；使用测量值修复，不凭坐标猜测。区域包含节点已表达归属时无需额外箭头；确有方向关系时路径必须接触目标主形状边界，不能仅改 after 而保留指向区域内部的箭头。
- 每个可见元素放 opening 或一个绑定 g 中；绑定组不嵌套。defs 保存本地渐变、箭头和裁剪。保留 title/desc，支持 role="img" 与指向现有 ID 的 aria-labelledby。
- opening 是静态开场组的保留 ID，不得写入 bindings 或 after；动画组使用唯一 ID（如 scene-opening），SVG 组 ID 与绑定及依赖引用保持一致。全画布背景也必须放在分组内，例如 `<g id="opening"><rect x="0" y="0" width="960" height="800" fill="#F4F8F1"/></g>`；该组与动画组并列，不包裹动画组。
- 绑定 kind 按语义选择：node 是实体节点；edge 是有向边；region 是允许有意包含或交叠的区域（如 Venn、嵌套容器）；mark 是数据标记、系列或 SVG 投影；label 是独立标签；connector 是无向关系线。几何检查对所有动画角色检查画布与人物安全区；只有 node 执行节点重叠与文字包围检查。图表标记外的文字使用 label，不用 node 假装数据系列。最多 40 个绑定，多枚标记按口播语义组合，不能嵌套动画绑定组。
- 节点主形状放在组内第一个，再放徽章、文字。关系连线先于节点绘制，计算真实边界交点，不能以节点内部坐标作终点；marker 尖端应停在边框外侧。卡片流程优先正交连线；鱼骨、依赖图、轴测等按所选类型允许斜线或弧线。坐标轴、数据线、极坐标和集合轮廓不套用流程图连线规则；loop 圆周布局使用一致圆心的弧线。
- edge 用 marker-end 表达方向，connector 不强制箭头；两者的 after 均至少包含两个不同的 node/region/mark，路径两端接触不同端点元素边界。数据线、网格线和桑基带使用 mark，不按业务连线检查。连线与节点同时触发时依赖时间不得冲突。循环业务关系不等于显现依赖成环。
- after 表示动画出现依赖，不直接照抄业务流程顺序。口播先讲处置、再补述先前损失时，处置节点不得依赖后讲的损失节点；保留业务连线的两端依赖，并选择不早于两端节点的口播触发词。
- 只使用镜头上下文或用户指令给出的事实与数值；定量图缺少必要数值时说明缺少的数据，不编造比例、数值或精度。轴测类型用静态 SVG 投影表达，不引入 3D 运行时。
- save_diagram 自动执行契约、语义证据与浏览器检查，保存预览截图。按报告修正连接点、遮挡、中文小字、越界；检查器异常会终止本轮，不能靠重画解决。
- 首次用 save_diagram，修复优先用 patch_diagram({baseHash, operations})；baseHash 取最新 candidateHash/hash。replace_group 提交相同 ID 的单个 g；update_binding 仅提交变化字段；remove_group 自动清理 SVG、binding 与其他 after 引用。补丁全量校验且原子应用，不会保留半份修改。不重发整张 SVG；需要详情时用 read_current_diagram({groupIds:[...]}) 仅读取失败组。
- 安全 SVG 会一次返回时间、语义及几何问题。repairs 中 cue_before_dependency 提供两个 cue 的原文及位置；text_overflow 提供文字与主框实测边界；edge_crosses_node 提供实际路径和 obstructionBounds，应修改路径绕开节点，不能把障碍加入 after。完整测量保存在候选文件，工具只返回相关分组。
- save_diagram 与 patch_diagram 共用默认五次真正修改预算；重复当前内容不扣保存次数，但仍消耗模型/工具步数。补丁的 baseHash 过期时先读取当前候选，再重新修复。通过校验后仍须 inspect_diagram 复查，不能自动采用。
- 最后调用 inspect_diagram 复查当前候选。支持图像的模型会收到完整截图；文本模型只收到坐标报告和截图位置，不能声称已看图。通过检查也不代表动画音画对齐已由人确认。
- 内容修改总次数（全量保存与补丁共用，含首次）以系统提示词和 save_diagram 返回的 remainingSaves 为准，默认 5 次。失败时优先处理 repairs：按 groupId 定位连线，结合口播选真实目标；候选 nearestBoundaryPoint 只是参考，不能接回源节点来绕过检查。若只是包含关系，删除多余连线的 SVG 组与 binding，并移除其他 after 对它的引用。unchangedErrors 表示连续提交仍有同样问题，必须实际修改路径或换用合适的关系表达，不得原样重交。校验失败如实说明；成功只简短说明本次变化与待预览状态。

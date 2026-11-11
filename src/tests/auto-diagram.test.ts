import assert from "node:assert/strict";
import {DOMParser} from "@xmldom/xmldom";
import {diagramCandidateHash, patchDiagram} from "../lib/diagram/candidate";
import {resolveNarrationCue} from "../remotion/templates/narration-cue";
import {diagramDataSchema, diagramSchedule, diagramSvgAtFrame, parseDiagramSvg, validateDiagram, type DiagramData} from "../remotion/templates/auto-diagram-schema";
import type {Caption} from "../remotion/schema";
import {SANS_FONT_FAMILY, SERIF_FONT_FAMILY} from "../remotion/typography";
import {diagramTypeCatalog, diagramTypeIds} from "../remotion/diagram-types";
import {validateDiagramMeaning} from "../lib/diagram/meaning";

// 仅测试安全和时间契约，不调用模型、浏览器、服务或渲染器。
const caption = (text: string, startMs: number, endMs: number): Caption => ({text, startMs, endMs, timestampMs: null, confidence: null});
const scene = {startMs: 0, endMs: 2000};
const captions = [caption("甲，乙。甲", 0, 1000), caption("乙ＡＢＣ", 1000, 2000)];
assert.deepEqual(resolveNarrationCue({scene, captions, text: "乙"}), {startMs: 400, endMs: 600});
assert.deepEqual(resolveNarrationCue({scene, captions, text: "甲", occurrence: 2}), {startMs: 800, endMs: 1000});
assert.deepEqual(resolveNarrationCue({scene, captions, text: "甲乙", occurrence: 2}), {startMs: 800, endMs: 1250});
assert.deepEqual(resolveNarrationCue({scene, captions, text: "abc"}), {startMs: 1250, endMs: 2000});
assert.equal(resolveNarrationCue({scene: {startMs: 700, endMs: 2000}, captions, text: "乙", occurrence: 2}), null);
assert.equal(resolveNarrationCue({scene, captions, text: "不存在"}), null);
assert.equal(resolveNarrationCue({scene, captions, text: "甲", occurrence: 0}), null);
assert.deepEqual(resolveNarrationCue({scene, captions: [caption("ﬃ，e\u0301 Ａ", 0, 1400)], text: "ffiéa"}), {startMs: 0, endMs: 1400});
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 800"><defs><linearGradient id="paint"><stop offset="0" stop-color="#fff"/></linearGradient></defs><g id="opening"><text x="24" y="40">标题</text></g><g id="first"><rect x="24" y="80" width="100" height="100" fill="url(#paint)"/></g><g id="second"><text x="200" y="100">第二步</text></g><g id="link"><path d="M124 100L200 100"/></g></svg>';
const data: DiagramData = diagramDataSchema.parse({type: "flowchart", svg, bindings: [{groupId: "first", name: "第一步", cueText: "甲"}, {groupId: "second", name: "第二步", cueText: "甲", occurrence: 2, after: ["first"]}, {groupId: "link", name: "连线", cueText: "乙", occurrence: 2, after: ["first", "second"], kind: "edge"}]});
// 所有主类型共用 SVG 和时间契约，不为已退役标识提供兼容别名。
assert.equal(diagramTypeCatalog.length, 45);
assert.equal(new Set(diagramTypeIds).size, 45);
for (const type of diagramTypeIds) assert.equal(validateDiagram(scene, captions, {...data, type}).type, type);
for (const type of ["flow", "hierarchy", "cycle", "unknown", "bubble", "flowchart "]) assert.equal(diagramDataSchema.safeParse({...data, type}).success, false);
assert.equal(diagramDataSchema.safeParse({...data, bindings: Array.from({length: 41}, (_, index) => ({...data.bindings[0]!, groupId: `item-${index}`}))}).success, false);
// 字体允许本地名称、CSS 引号及项目回退栈；系统字体不能成为首选字体。
const withFont = (font: string) => ({...data, svg: svg.replace('<g id="first">', `<g id="first" font-family="${font.replaceAll('"', "&quot;")}">`)});
for (const font of ["Studio Sans", "Studio Serif", '"Studio Sans"', "'Studio Serif'", " Studio Sans ", SANS_FONT_FAMILY, SERIF_FONT_FAMILY]) assert.doesNotThrow(() => parseDiagramSvg(withFont(font)));
for (const font of ["Arial", "sans-serif", "Arial, Studio Sans", "Studio Sans, Unknown Font", "'Studio Sans", "Studio Sans,"]) assert.throws(() => parseDiagramSvg(withFont(font)), /项目本地字体/);
const schedule = diagramSchedule(scene, captions, data);
assert.equal(schedule[1]!.startMs, 800);
const first = diagramSvgAtFrame(data, schedule, 0);
const last = diagramSvgAtFrame(data, schedule, 59);
assert.match(first, /id="second" opacity="0"/);
assert.match(last, /id="second" opacity="1"/);
assert.equal(diagramSvgAtFrame(data, schedule, 59), last);
assert.equal(diagramSvgAtFrame(data, schedule, 0), first);
assert.match(diagramSvgAtFrame(data, schedule, 0, true, "preview"), /url\(#preview-paint\)/);
const late = diagramSchedule({startMs: 0, endMs: 34}, [caption("甲", 33, 34)], {...data, bindings: [{...data.bindings[0]!, after: []}]}, 30);
assert.equal(late[0]!.startFrame, 0);
assert.equal(late[0]!.fadeFrames, 0);
assert.throws(() => parseDiagramSvg({...data, svg: svg.replace('<g id="first">', '<g id="first" onclick="alert(1)">')}));
assert.throws(() => parseDiagramSvg({...data, svg: svg.replace('<g id="first">', '<script/> <g id="first">')}));
assert.throws(() => parseDiagramSvg({...data, svg: svg.replace('url(#paint)', 'url(https://example.com/image)')}));
assert.throws(() => parseDiagramSvg({...data, svg: svg.replace('id="second"', 'id="first"')}));
assert.throws(() => parseDiagramSvg({...data, svg: svg.replace('<g id="second">', '<g id="outside"><rect width="2" height="2"/></g><g id="second">')}));
assert.throws(() => parseDiagramSvg({...data, svg: svg.replace('</g><g id="second">', '<g id="second">').replace('</svg>', '</g></svg>')}));
assert.throws(() => diagramSchedule(scene, captions, {...data, bindings: data.bindings.map((binding, i) => i === 0 ? {...binding, after: ["second"]} : binding)}));
assert.throws(() => diagramSchedule(scene, captions, {...data, bindings: [{...data.bindings[0]!, after: ["missing"]}]}));
assert.throws(() => diagramSchedule(scene, captions, {...data, bindings: [{...data.bindings[0]!, cueText: "丙"}]}));
assert.throws(() => diagramSchedule(scene, captions, {...data, bindings: [{...data.bindings[2]!, after: ["first"]}]}));

// 新动画角色保留同一套触发、显现与依赖约束；无向连接不需要 SVG 箭头。
const chart = diagramDataSchema.parse({...data, type: "bar", bindings: data.bindings.map((binding, index) => ({...binding, kind: index < 2 ? "mark" : "connector"}))});
assert.doesNotThrow(() => validateDiagram(scene, captions, chart));
assert.equal(diagramSchedule(scene, captions, chart)[2]!.startMs, schedule[2]!.startMs);
assert.match(diagramSvgAtFrame(chart, diagramSchedule(scene, captions, chart), 0), /id="link" opacity="0"/);
assert.match(diagramSvgAtFrame(chart, diagramSchedule(scene, captions, chart), 59), /id="link" opacity="1"/);
for (const kind of ["region", "mark", "label"] as const) {
  const single = {...data, bindings: [{...data.bindings[0]!, kind, after: []}]};
  assert.equal(diagramSchedule(scene, captions, single)[0]!.startMs, 0);
  assert.throws(() => diagramSchedule(scene, captions, {...single, bindings: [{...single.bindings[0]!, cueText: "不存在"}]}));
  assert.throws(() => diagramSchedule(scene, captions, {...single, bindings: [{...single.bindings[0]!, after: ["first"]}]}));
}
assert.throws(() => diagramSchedule(scene, captions, {...chart, bindings: chart.bindings.map((binding, index) => index === 1 ? {...binding, kind: "label" as const} : binding)}));
assert.throws(() => diagramSchedule(scene, captions, {...chart, bindings: chart.bindings.map((binding, index) => index === 2 ? {...binding, after: ["first", "first"]} : binding)}));
assert.doesNotThrow(() => diagramSchedule(scene, captions, {...chart, bindings: chart.bindings.map((binding, index) => index === 2 ? {...binding, kind: "edge" as const} : binding)}));
// 回归：节点指向语义区域的有向边是有效关系，但出现时间仍不能早于目标区域。
const regionEdge = {...data, bindings: data.bindings.map((binding, index) => index === 1 ? {...binding, kind: "region" as const} : binding)};
assert.doesNotThrow(() => diagramSchedule(scene, captions, regionEdge));
assert.throws(() => diagramSchedule(scene, captions, {...regionEdge, bindings: regionEdge.bindings.map((binding, index) => index === 2 ? {...binding, cueText: "甲", occurrence: 1} : binding)}), /触发早于前置元素 second/);
assert.throws(() => diagramSchedule(scene, captions, {...chart, bindings: chart.bindings.map((binding, index) => index === 0 ? {...binding, after: ["link"]} : binding)}));

// loop 必须引用本镜头的明确回边原文，持续时间或“环环相扣”不能证明循环。
const loop = {...data, type: "loop" as const};
assert.throws(() => validateDiagramMeaning(loop, "整条攻击链环环相扣。", "环环相扣"));
assert.throws(() => validateDiagramMeaning(loop, "先投毒，再进入系统。", "结果反馈回到输入"));
assert.throws(() => validateDiagramMeaning(loop, "结果反馈回到输入，开始下一轮。"));
assert.doesNotThrow(() => validateDiagramMeaning(loop, "结果反馈回到输入，开始下一轮。", "结果反馈回到输入"));
assert.doesNotThrow(() => validateDiagramMeaning(data, "先投毒，再进入系统。"));

// diagram-design 的无障碍引用应通过白名单，并随同页预览实例隔离。
const accessible = {...data, svg: svg.replace('<defs>', '<title id="diagram-title">流程</title><desc id="diagram-desc">两个步骤</desc><defs>').replace('viewBox="0 0 960 800"', 'viewBox="0 0 960 800" role="img" aria-labelledby="diagram-title diagram-desc"')};
assert.doesNotThrow(() => parseDiagramSvg(accessible));
assert.match(diagramSvgAtFrame(accessible, schedule, 0, true, "accessible"), /aria-labelledby="accessible-diagram-title accessible-diagram-desc"/);
assert.throws(() => parseDiagramSvg({...accessible, svg: accessible.svg.replace('role="img"', 'role="button"')}));
assert.throws(() => parseDiagramSvg({...accessible, svg: accessible.svg.replace('diagram-title diagram-desc', 'missing-title')}));


// 总览按帧淡出，首个触发后恢复原有累积显现，往返跳帧不残留状态。
const overview = diagramDataSchema.parse({...data, showFullDiagramFirst: true});
assert.equal(diagramDataSchema.parse(data).showFullDiagramFirst, undefined);
assert.equal(diagramDataSchema.safeParse({...data, showFullDiagramFirst: "true"}).success, false);
assert.equal(diagramCandidateHash(data), diagramCandidateHash({...data, showFullDiagramFirst: false}));
assert.notEqual(diagramCandidateHash(data), diagramCandidateHash(overview));
assert.equal(patchDiagram(overview, undefined, {baseHash: diagramCandidateHash(overview), operations: [{op: "update_binding", groupId: "first", changes: {name: "新名称"}}]}).showFullDiagramFirst, true);
const delayedScene = {startMs: 0, endMs: 3000};
const delayedCaptions = [caption("甲，乙。甲", 600, 1600), caption("乙ＡＢＣ", 1600, 2600)];
const opacityAt = (input: DiagramData, timing: ReturnType<typeof diagramSchedule>, frame: number, groupId = "second", complete = false) => {
  const doc = new DOMParser().parseFromString(diagramSvgAtFrame(input, timing, frame, complete), "image/svg+xml");
  const group = doc.getElementById(groupId);
  assert(group, `缺少分组 ${groupId}`);
  return group.hasAttribute("opacity") ? Number(group.getAttribute("opacity")) : 1;
};
for (const fps of [30, 60]) {
  const timing = diagramSchedule(delayedScene, delayedCaptions, overview, fps);
  const ordinaryTiming = diagramSchedule(delayedScene, delayedCaptions, data, fps);
  assert.deepEqual(timing, ordinaryTiming);
  const firstCue = timing[0]!.startFrame;
  const fade = Math.round(fps * .24);
  assert.equal(opacityAt(overview, timing, 0), 1);
  assert.equal(opacityAt(data, timing, 0), 0);
  assert.equal(diagramSvgAtFrame(data, timing, 0), diagramSvgAtFrame({...data, showFullDiagramFirst: false}, timing, 0));
  assert.equal(opacityAt(overview, timing, firstCue - fade), 1);
  assert.equal(opacityAt(overview, timing, firstCue - 1), 1 / fade);
  assert.equal(opacityAt(overview, timing, firstCue), 0);
  assert.equal(opacityAt(overview, timing, firstCue + 1, "first"), 1 / timing[0]!.fadeFrames);
  assert.equal(opacityAt(overview, timing, firstCue + fade, "first"), 1);
  assert.equal(opacityAt(overview, timing, firstCue + fade), 0);
  assert.equal(opacityAt(overview, timing, timing[1]!.startFrame + timing[1]!.fadeFrames), 1);
  assert.equal(opacityAt(overview, timing, firstCue, "opening"), 1);
  assert.equal(opacityAt(overview, timing, firstCue, "link", true), 1);
  const earlier = diagramSvgAtFrame(overview, timing, firstCue - 1);
  diagramSvgAtFrame(overview, timing, timing[2]!.startFrame + fade);
  assert.equal(diagramSvgAtFrame(overview, timing, firstCue - 1), earlier);
  // 开场不足 240ms 时从首帧开始缩短淡出，不推迟首个口播触发。
  const shortTiming = diagramSchedule(delayedScene, [caption("甲，乙。甲", 100, 1100), caption("乙ＡＢＣ", 1100, 2100)], overview, fps);
  assert.equal(opacityAt(overview, shortTiming, 0), 1);
  assert.equal(opacityAt(overview, shortTiming, shortTiming[0]!.startFrame - 1), 1 / shortTiming[0]!.startFrame);
  assert.equal(opacityAt(overview, shortTiming, shortTiming[0]!.startFrame), 0);
}
assert.equal(diagramSvgAtFrame(overview, schedule, 0), diagramSvgAtFrame(data, schedule, 0));
// 分组列表无须按触发时间排序，总览结束点始终使用最早触发。
assert.equal(diagramSvgAtFrame(overview, [...diagramSchedule(delayedScene, delayedCaptions, overview)].reverse(), 0), diagramSvgAtFrame(overview, diagramSchedule(delayedScene, delayedCaptions, overview), 0));

console.log("自动图表安全、口播时间与总览过渡契约通过");

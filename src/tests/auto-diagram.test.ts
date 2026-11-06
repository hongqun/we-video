import assert from "node:assert/strict";
import {resolveNarrationCue} from "../remotion/templates/narration-cue";
import {diagramDataSchema, diagramSchedule, diagramSvgAtFrame, parseDiagramSvg, validateDiagram, type DiagramData} from "../remotion/templates/auto-diagram-schema";
import type {Caption} from "../remotion/schema";
import {SANS_FONT_FAMILY, SERIF_FONT_FAMILY} from "../remotion/typography";

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
const data: DiagramData = diagramDataSchema.parse({type: "flow", svg, bindings: [{groupId: "first", name: "第一步", cueText: "甲"}, {groupId: "second", name: "第二步", cueText: "甲", occurrence: 2, after: ["first"]}, {groupId: "link", name: "连线", cueText: "乙", occurrence: 2, after: ["first", "second"], kind: "edge"}]});
for (const type of ["flow", "architecture", "hierarchy", "cycle", "timeline"] as const) assert.equal(validateDiagram(scene, captions, {...data, type}).type, type);
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

// diagram-design 的无障碍引用应通过白名单，并随同页预览实例隔离。
const accessible = {...data, svg: svg.replace('<defs>', '<title id="diagram-title">流程</title><desc id="diagram-desc">两个步骤</desc><defs>').replace('viewBox="0 0 960 800"', 'viewBox="0 0 960 800" role="img" aria-labelledby="diagram-title diagram-desc"')};
assert.doesNotThrow(() => parseDiagramSvg(accessible));
assert.match(diagramSvgAtFrame(accessible, schedule, 0, true, "accessible"), /aria-labelledby="accessible-diagram-title accessible-diagram-desc"/);
assert.throws(() => parseDiagramSvg({...accessible, svg: accessible.svg.replace('role="img"', 'role="button"')}));
assert.throws(() => parseDiagramSvg({...accessible, svg: accessible.svg.replace('diagram-title diagram-desc', 'missing-title')}));

console.log("自动图表安全与口播时间契约通过");

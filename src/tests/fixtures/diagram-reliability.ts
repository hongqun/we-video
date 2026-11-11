import {diagramDataSchema} from "../../remotion/templates/auto-diagram-schema";
import type {Caption} from "../../remotion/schema";

// 从 2026-11-10 示例提炼最小夹具，保留故障分组、真实字号和路径坐标。
const wrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 800"><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z"/></marker></defs>${body}</svg>`;
export const diagramFixtureScene = {startMs: 0, endMs: 10000};
export const diagramFixtureArea = {x: 24, y: 24, width: 912, height: 752};
export const diagramFixtureSpoken = "问题向量开始检索向量库使用MongoDB Atlas总结最后搭桥";
export const diagramFixtureCaptions: Caption[] = [{text: diagramFixtureSpoken, startMs: 0, endMs: 10000, timestampMs: null, confidence: null}];
export const failingRetrievalDiagram = () => diagramDataSchema.parse({type: "flowchart", svg: wrap(`
  <g id="e-qvec-vault"><path d="M448 284L702 284" fill="none" stroke="#4F6BFF" marker-end="url(#arrow)"/></g>
  <g id="b-qvec"><rect x="268" y="248" width="180" height="72"/></g>
  <g id="b-retrieve"><rect x="488" y="248" width="180" height="72"/></g>
  <g id="b-vault"><rect x="708" y="248" width="204" height="72"/></g>
  <g id="b-mongo"><rect x="816" y="356" width="96" height="60"/><text x="864" y="392" text-anchor="middle" font-family="Studio Sans" font-size="16" font-weight="600">MongoDB Atlas</text></g>
  <g id="b-bridge"><rect x="48" y="452" width="864" height="64"/></g>
  <g id="l-legend"><text x="48" y="552" font-size="20">图例</text></g>
`), bindings: [
  {groupId: "b-qvec", name: "问题向量", cueText: "问题向量"},
  {groupId: "b-retrieve", name: "检索", cueText: "检索"},
  {groupId: "b-vault", name: "向量库", cueText: "向量库"},
  {groupId: "e-qvec-vault", name: "问题向量进入向量库", cueText: "向量库", after: ["b-qvec", "b-vault"], kind: "edge"},
  {groupId: "b-mongo", name: "MongoDB Atlas", cueText: "MongoDB Atlas"},
  {groupId: "b-bridge", name: "桥", cueText: "最后搭桥"},
  {groupId: "l-legend", name: "图例", cueText: "总结", after: ["b-bridge"], kind: "label"},
]});

export const containedVectorDiagram = () => diagramDataSchema.parse({type: "nested", svg: wrap(`
  <g id="s1-map"><rect x="32" y="40" width="896" height="728" fill="none" stroke="#222"/></g>
  <g id="s20-arrow-vector"><path d="M156 364L156 380" fill="none" stroke="#222" marker-end="url(#arrow)"/></g>
  <g id="s6-vector"><rect x="56" y="320" width="200" height="44"/></g>
  <g id="summary"><text x="300" y="600" font-size="20">总结</text></g>
`), bindings: [
  {groupId: "s1-map", name: "语义地图", cueText: "问题向量", kind: "region"},
  {groupId: "s6-vector", name: "向量", cueText: "向量库"},
  {groupId: "s20-arrow-vector", name: "向量到语义地图", cueText: "向量库", kind: "edge", after: ["s1-map", "s6-vector"]},
  {groupId: "summary", name: "总结", cueText: "总结", kind: "label", after: ["s20-arrow-vector"]},
]});

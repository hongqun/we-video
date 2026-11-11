import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {diagramTypeCatalog} from "../remotion/diagram-types";
import {resolveDiagramResources} from "../lib/diagram/resources";

// 显式执行时核对真实安装的上游目录，避免只检查项目自身常量而漏掉类型或资料。
const main = async () => {
  const resources = await resolveDiagramResources();
  assert.equal(resources.unavailable, undefined);
  const skill = await readFile(path.join(resources.skillDirectory, "SKILL.md"), "utf8");
  const guide = skill.split("### Visual-type guide (45)")[1]?.split("Rules of thumb:")[0];
  assert(guide, "安装的 Skill 缺少 45 种主类型表，请审核上游变更");
  const upstreamIds = [...guide.matchAll(/\(references\/type-([\w-]+)\.md\)/gu)].map((match) => match[1]!);
  assert.equal(upstreamIds.length, 45);
  assert.deepEqual(diagramTypeCatalog.map(({id}) => id).sort(), upstreamIds.sort());
  for (const entry of diagramTypeCatalog) {
    assert(entry.label.trim());
    const [reference, example] = await Promise.all([entry.reference, entry.example].map((file) => readFile(path.join(resources.skillDirectory, file), "utf8")));
    assert(reference.trim(), `${entry.id} 缺少参考正文`);
    assert.match(example, /<svg\b/iu, `${entry.id} 缺少 SVG 静态示例`);
    assert(!entry.example.includes("animated"));
  }
  console.log("45 种主类型及已安装 Skill 资料核对通过");
};
main().catch((error) => {console.error(error); process.exitCode = 1;});

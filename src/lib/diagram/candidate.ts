import {createHash} from "node:crypto";
import {DOMParser, XMLSerializer, type Element} from "@xmldom/xmldom";
import {z} from "zod";
import {diagramBindingSchema, diagramDataSchema, parseDiagramSvg, type DiagramData} from "../../remotion/templates/auto-diagram-schema";

// 只忽略结构空白和属性顺序；文字空白、绘制顺序及实际坐标仍参与指纹。
export const diagramCandidateHash = (data: DiagramData, loopEvidence?: string) => {
  const {root} = parseDiagramSvg(data);
  const canonical = (element: Element): unknown => ({
    tag: element.tagName,
    attributes: Array.from({length: element.attributes.length}, (_, index) => {
      const attribute = element.attributes.item(index)!;
      return [attribute.name, attribute.value];
    }).sort(([a], [b]) => a!.localeCompare(b!)),
    children: Array.from({length: element.childNodes.length}, (_, index) => element.childNodes.item(index)!).flatMap((node): unknown[] => node.nodeType === 1
      ? [canonical(node as Element)]
      : node.nodeValue?.trim() || ["text", "tspan", "title", "desc"].includes(element.tagName) ? [node.nodeValue] : []),
  });
  const bindings = data.bindings.map((binding) => ({groupId: binding.groupId, name: binding.name, cueText: binding.cueText, occurrence: binding.occurrence, after: [...binding.after].sort(), kind: binding.kind})).sort((a, b) => a.groupId.localeCompare(b.groupId));
  return createHash("sha256").update(JSON.stringify({type: data.type, svg: canonical(root), bindings, loopEvidence: loopEvidence?.trim() ?? ""})).digest("hex");
};

const groupId = diagramBindingSchema.shape.groupId;
// 局部更新不能继承原绑定的默认值，否则改触发词会意外清空依赖或把边改成节点。
const bindingChanges = diagramBindingSchema.omit({groupId: true}).extend({
  occurrence: diagramBindingSchema.shape.occurrence.removeDefault(),
  after: diagramBindingSchema.shape.after.removeDefault(),
  kind: diagramBindingSchema.shape.kind.removeDefault(),
}).partial().strict();
export const diagramPatchSchema = z.object({
  baseHash: z.string().regex(/^[a-f0-9]{64}$/),
  operations: z.array(z.discriminatedUnion("op", [
    z.object({op: z.literal("replace_group"), groupId, svg: z.string().min(1).max(300000)}).strict(),
    z.object({op: z.literal("update_binding"), groupId, changes: bindingChanges}).strict(),
    z.object({op: z.literal("remove_group"), groupId}).strict(),
  ])).min(1).max(40),
}).strict();

// 补丁先在内存副本上完成并通过白名单；失败时不留下半份 SVG 或绑定。
export const patchDiagram = (data: DiagramData, loopEvidence: string | undefined, input: z.infer<typeof diagramPatchSchema>): DiagramData => {
  input = diagramPatchSchema.parse(input);
  if (input.baseHash !== diagramCandidateHash(data, loopEvidence)) throw new Error("候选已变化，请重新读取 baseHash 后再修复");
  const {doc} = parseDiagramSvg(data);
  let bindings = data.bindings.map((binding) => ({...binding, after: [...binding.after]}));
  const removed = new Set<string>();
  const removedSvgIds = new Set<string>();
  for (const operation of input.operations) {
    const element = doc.getElementById(operation.groupId);
    const binding = bindings.find((item) => item.groupId === operation.groupId);
    if (!element || (!binding && operation.groupId !== "opening") || removed.has(operation.groupId)) throw new Error(`补丁分组不存在或不可编辑：${operation.groupId}`);
    if (operation.op === "replace_group") {
      const errors: string[] = [];
      if (/<!|<\?/u.test(operation.svg)) throw new Error("补丁不允许声明、实体或注释");
      const fragment = new DOMParser({onError: (_level, message) => {errors.push(message);}}).parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${operation.svg}</svg>`, "image/svg+xml");
      const root = fragment.documentElement;
      if (!root) throw new Error("补丁分组解析失败");
      const children = Array.from({length: root.childNodes.length}, (_, index) => root.childNodes.item(index)!).filter((node) => node.nodeType !== 3 || node.nodeValue?.trim());
      const replacement = children[0] as Element | undefined;
      if (errors.length || children.length !== 1 || replacement?.tagName !== "g" || replacement.getAttribute("id") !== operation.groupId) throw new Error("替换内容必须是相同 ID 的单个 g 分组");
      element.parentNode!.replaceChild(doc.importNode(replacement, true), element);
    } else if (operation.op === "update_binding") {
      if (!binding) throw new Error("opening 没有可更新的口播绑定");
      bindings = bindings.map((item) => item.groupId === operation.groupId ? diagramBindingSchema.parse({...item, ...operation.changes}) : item);
    } else {
      // 连线删除后同步清理无障碍 ID 引用，避免只剩悬空标签引用。
      const collectIds = (node: Element) => {
        if (node.hasAttribute("id")) removedSvgIds.add(node.getAttribute("id")!);
        for (let child = node.firstChild; child; child = child.nextSibling) if (child.nodeType === 1) collectIds(child as Element);
      };
      collectIds(element);
      element.parentNode!.removeChild(element);
      bindings = bindings.filter((item) => item.groupId !== operation.groupId);
      removed.add(operation.groupId);
    }
  }
  bindings = bindings.map((binding) => ({...binding, after: binding.after.filter((dependency) => !removed.has(dependency))}));
  for (const element of Array.from(doc.getElementsByTagName("*"))) for (const attribute of ["aria-labelledby", "aria-describedby"]) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const targets = value.trim().split(/\s+/u).filter((id) => !removedSvgIds.has(id));
    if (targets.length) element.setAttribute(attribute, targets.join(" "));
    else element.removeAttribute(attribute);
  }
  const next = diagramDataSchema.parse({...data, svg: new XMLSerializer().serializeToString(doc), bindings});
  parseDiagramSvg(next);
  return next;
};

// 重交当前内容不扣保存次数；真正修改仍受共享预算约束。
export class DiagramSaveBudget {
  attempts = 0;
  constructor(readonly maxSaves: number) {}
  accept(nextHash: string, currentHash?: string) {
    if (nextHash === currentHash) return false;
    if (this.attempts >= this.maxSaves) throw new Error(`图表保存达到 ${this.maxSaves} 次预算（含首次提交），请继续对话修改`);
    this.attempts++;
    return true;
  }
}

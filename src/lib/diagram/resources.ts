import {constants, promises as fs} from "node:fs";
import path from "node:path";
import {diagramTypeCatalog} from "../../remotion/diagram-types";

export const diagramSkillInstallCommand = "npx skills add cathrynlavery/diagram-design --skill diagram-design --agent deepagents --copy --yes";
export const diagramSkillVirtualPath = "/skills/diagram-design/";

// 只检查视频契约会读取的资料，独立安装的其他 Skill 不参与运行时加载。
const requiredSkillFiles = [
  "SKILL.md",
  "references/semantic-patterns.md", "references/primitives-core.md",
  ...diagramTypeCatalog.flatMap(({reference, example}) => [reference, example]),
];

export const resolveDiagramResources = async () => {
  const skillDirectory = path.join(process.cwd(), ".agents/skills/diagram-design");
  const contractDirectory = path.join(process.cwd(), "packages/diagram-agent/resources");
  const readableFile = async (file: string) => {
    try {
      const stat = await fs.stat(file);
      await fs.access(file, constants.R_OK);
      return stat.isFile() && stat.size > 0;
    } catch {return false;}
  };
  // 服务端预检和 worker 启动共用检查，缺失资料时在 Step 4 显示可操作的安装提示。
  const present = await Promise.all(requiredSkillFiles.map((file) => readableFile(path.join(skillDirectory, file))));
  const missing = requiredSkillFiles.filter((_, index) => !present[index]);
  const contractPresent = await readableFile(path.join(contractDirectory, "video-diagram-contract.md"));
  const unavailable = missing.length
    ? `diagram-design 未安装或资料不完整（缺少 ${missing.join("、")}），请在项目根目录执行：${diagramSkillInstallCommand}`
    : !contractPresent ? "视频图表契约缺失，请重新部署 packages/diagram-agent/resources/video-diagram-contract.md" : undefined;
  return {skillDirectory, contractDirectory, unavailable};
};

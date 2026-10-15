import {promises as fs} from "node:fs";
import {acceptNarration, createNarration, discardNarration, reviseNarration} from "@/lib/narration";
import {readPlatformProfile, readJobPlatformProfile} from "@/lib/profile";
import {readJob} from "@/lib/jobs";

const argument = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const required = (name: string) => { const value = argument(name); if (!value) throw new Error(`缺少 ${name}`); return value; };

const main = async () => {
  // Worker 只负责解析命令并调用领域服务，文稿规则集中在 lib/narration.ts。
  const command = process.argv[2];
  const jobId = required("--job-id");
  if (command === "create") {
    const input = JSON.parse(await fs.readFile(required("--input"), "utf8")) as Parameters<typeof createNarration>[1];
    const profile = await readPlatformProfile(argument("--account-id"), argument("--series-id"));
    await createNarration(jobId, input, profile, argument("--text-model") ?? profile.defaultTextModel ?? "deepseek-v4-flash");
  } else if (command === "revise") {
    const input = JSON.parse(await fs.readFile(required("--input"), "utf8")) as {draft: Record<string, unknown>; feedback: string};
    const job = await readJob(jobId);
    const profile = await readJobPlatformProfile(job.contentProfile);
    await reviseNarration(jobId, input.draft, input.feedback, profile, job.generation?.textModel ?? profile.defaultTextModel ?? "deepseek-v4-flash");
  } else if (command === "accept") await acceptNarration(jobId);
  else if (command === "discard") await discardNarration(jobId);
  else throw new Error(`不支持的口播命令：${command ?? ""}`);
};

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

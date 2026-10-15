import {runTranslation} from "@/lib/derivation";

// Worker 只负责命令入口；译稿、状态和分段约束统一由领域服务处理。
const main = async () => {
  const action = process.argv[2];
  const index = process.argv.indexOf("--job-id");
  const jobId = index >= 0 ? process.argv[index + 1] : undefined;
  if (!jobId || (action !== "generate" && action !== "confirm")) throw new Error("缺少翻译任务 ID 或命令");
  await runTranslation(jobId, action);
};

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

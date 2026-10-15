import {runVisualPlanWorker, visualPlanWorkerArgument} from "@/lib/visual-planner";

const value = (name: string) => visualPlanWorkerArgument(process.argv, name);
const command = process.argv[2] as "generate" | "replan";
// Worker 负责承接长耗时规划，具体的模型调用、契约装配和落盘统一由 visual-planner 管理。
const jobId = value("--job-id");
if (!jobId || !["generate", "replan"].includes(command)) throw new Error("用法：visual-plan-worker <generate|replan> --job-id <id>");
runVisualPlanWorker(command, jobId, value("--feedback")).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

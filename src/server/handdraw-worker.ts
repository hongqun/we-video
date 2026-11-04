import {prepareHanddraw} from "../lib/handdraw";

// 独立进程让图片分析不占用上传请求，结果由请求 ID 防止过期回写。
const [jobId, sceneId, requestId] = process.argv.slice(2);
if (!jobId || !sceneId || !requestId) throw new Error("用法：handdraw-worker <jobId> <sceneId> <requestId>");
void prepareHanddraw(jobId, sceneId, requestId).catch((error) => {console.error(error); process.exitCode = 1;});

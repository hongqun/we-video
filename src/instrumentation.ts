// Next.js 在服务启动时（dev 与 next start / systemd 均生效）自动调用 register()。
// 在此启动过期音视频媒体的定时清理（默认保留 15 天），见 src/lib/cleanup.ts。
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const {scheduleMediaCleanup} = await import("@/lib/cleanup");
  scheduleMediaCleanup();
  // 重启后保留图表文件，但不续跑已经消失的执行进程。
  const {recoverDiagramRequests} = await import("@/lib/diagram/service");
  await recoverDiagramRequests().catch(() => undefined);
}

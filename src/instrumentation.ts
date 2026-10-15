// Next.js 在服务启动时（dev 与 next start / systemd 均生效）自动调用 register()。
// 在此启动过期音视频媒体的定时清理（默认保留 15 天），见 src/lib/cleanup.ts。
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const {scheduleMediaCleanup} = await import("@/lib/cleanup");
  scheduleMediaCleanup();
}

import type {Metadata} from "next";
import "./globals.css";


export async function generateMetadata(): Promise<Metadata> {
  // 应用外壳不依赖内容配置，首次使用和配置修复始终可访问。
  return {title: "We-Video 视频创作", description: "AI 视频创作工作台"};
}

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}

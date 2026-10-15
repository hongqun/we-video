import type {Metadata} from "next";
import "./globals.css";
import {readPlatformProfile} from "@/lib/profile";

export async function generateMetadata(): Promise<Metadata> {
  const profile = await readPlatformProfile();
  return {title: profile.workspaceTitle, description: profile.workspaceDescription};
}

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}

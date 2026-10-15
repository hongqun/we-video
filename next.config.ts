import {execFileSync} from "node:child_process";
import path from "node:path";
import type {NextConfig} from "next";
import packageJson from "./package.json";

const readGitValue = (args: string[]): string => {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

const gitCommit = readGitValue(["log", "-1", "--format=%h"]);
const gitCommitTime = readGitValue(["log", "-1", "--format=%cI"]);
const allowedDevOrigins = (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? "192.168.1.31,localhost,127.0.0.1")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins,
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    NEXT_PUBLIC_GIT_COMMIT: gitCommit,
    NEXT_PUBLIC_GIT_COMMIT_TIME: gitCommitTime,
  },
  serverExternalPackages: ["@remotion/bundler", "@remotion/renderer"],
  turbopack: {root: path.resolve(process.cwd(), "..")},
};

export default nextConfig;

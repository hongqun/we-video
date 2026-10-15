import {appendFile, chmod, mkdir, readFile, rename, stat} from "node:fs/promises";
import path from "node:path";
import {DATA_ROOT} from "./paths";

const LOG_FILE = path.join(DATA_ROOT, "login-failures.jsonl");
const ROTATED_LOG_FILE = `${LOG_FILE}.1`;
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_RECORDS = 200;

export type LoginFailure = {
  timestamp: string;
  ip: string;
  userAgent: string;
  reason: string;
};

const truncate = (value: string, maxLength: number) => value.slice(0, maxLength);

const requestIp = (request: Request) => {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return truncate(
    forwarded || request.headers.get("x-real-ip")?.trim() || "unknown",
    128,
  );
};

export const recordLoginFailure = async (request: Request, reason: string) => {
  await mkdir(DATA_ROOT, {recursive: true});
  try {
    const current = await stat(LOG_FILE);
    if (current.size >= MAX_LOG_BYTES) {
      await rename(LOG_FILE, ROTATED_LOG_FILE);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const record: LoginFailure = {
    timestamp: new Date().toISOString(),
    ip: requestIp(request),
    userAgent: truncate(request.headers.get("user-agent") ?? "unknown", 512),
    reason: truncate(reason, 160),
  };
  await appendFile(LOG_FILE, `${JSON.stringify(record)}\n`, {encoding: "utf8", mode: 0o600});
  await chmod(LOG_FILE, 0o600);
};

export const readLoginFailures = async (): Promise<LoginFailure[]> => {
  try {
    const content = await readFile(LOG_FILE, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .slice(-MAX_RECORDS)
      .reverse()
      .flatMap((line) => {
        try {
          const value = JSON.parse(line) as Partial<LoginFailure>;
          if (
            typeof value.timestamp !== "string" ||
            typeof value.ip !== "string" ||
            typeof value.userAgent !== "string" ||
            typeof value.reason !== "string"
          ) return [];
          return [{
            timestamp: value.timestamp,
            ip: value.ip,
            userAgent: value.userAgent,
            reason: value.reason,
          }];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};

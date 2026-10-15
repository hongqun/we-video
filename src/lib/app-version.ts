import {promises as fs} from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {DATA_ROOT} from "@/lib/paths";

const VERSION_FILE = path.join(DATA_ROOT, "app-version.json");
const DEFAULT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "1.0.0";
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

let updateQueue = Promise.resolve();

const normalizeVersion = (value: unknown): string => {
  if (typeof value !== "string" || !SEMVER_RE.test(value)) return DEFAULT_VERSION;
  return value;
};

const readStoredVersion = async (): Promise<string> => {
  try {
    const content = await fs.readFile(VERSION_FILE, "utf8");
    const parsed = JSON.parse(content) as {version?: unknown};
    return normalizeVersion(parsed.version);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_VERSION;
    throw error;
  }
};

const writeStoredVersion = async (version: string): Promise<void> => {
  await fs.mkdir(DATA_ROOT, {recursive: true});
  const temporary = path.join(DATA_ROOT, `.app-version.${process.pid}.${randomUUID()}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify({version})}\n`, "utf8");
  await fs.rename(temporary, VERSION_FILE);
};

export const readAppVersion = readStoredVersion;

export const bumpAppVersion = async (): Promise<string> => {
  const next = updateQueue.then(async () => {
    const current = await readStoredVersion();
    const match = current.match(SEMVER_RE);
    if (!match) return DEFAULT_VERSION;
    const version = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
    await writeStoredVersion(version);
    return version;
  });
  updateQueue = next.then(() => undefined, () => undefined);
  return next;
};

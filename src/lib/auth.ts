import {createHmac, timingSafeEqual} from "node:crypto";
import {cookies} from "next/headers";
import {NextResponse} from "next/server";

export const SESSION_COOKIE = "talk-video-session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const secret = () => process.env.SESSION_SECRET?.trim() ?? "";
const configuredPassword = () => process.env.APP_PASSWORD ?? "";

const signature = (value: string) =>
  createHmac("sha256", secret()).update(value).digest("base64url");

const secureCookie = process.env.AUTH_COOKIE_SECURE === "true";

export const isAuthConfigured = () => Boolean(configuredPassword() && secret());

export const passwordMatches = (password: string) => {
  const expected = Buffer.from(configuredPassword());
  const actual = Buffer.from(password);
  return expected.length > 0 && expected.length === actual.length && timingSafeEqual(expected, actual);
};

export const createSession = () => {
  const value = String(Date.now());
  return `${value}.${signature(value)}`;
};

export const verifySession = (value: string | undefined) => {
  if (!value || !isAuthConfigured()) return false;
  const [issuedAt, providedSignature] = value.split(".");
  if (!issuedAt || !providedSignature || !/^\d+$/.test(issuedAt)) return false;
  const age = Date.now() - Number(issuedAt);
  if (age < 0 || age > SESSION_TTL_MS) return false;
  const expected = Buffer.from(signature(issuedAt));
  const actual = Buffer.from(providedSignature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: secureCookie,
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
};

export const requireAuth = async () => {
  const store = await cookies();
  if (verifySession(store.get(SESSION_COOKIE)?.value)) return null;
  return NextResponse.json({error: "请先登录"}, {status: 401});
};

import {createHmac, timingSafeEqual} from "node:crypto";

const renderSecret = () => process.env.SESSION_SECRET?.trim() ?? "";

const MAX_RENDER_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export const createRenderArtifactToken = (jobId: string, purpose: "preview" | "render" = "preview") => {
  // Keep the URL stable across snapshot polling while limiting exposure to a short window.
  const issuedAt = (Math.floor(Date.now() / (5 * 60 * 1000)) * 5 * 60 * 1000).toString();
  const secret = renderSecret();
  if (!secret) throw new Error("渲染音频访问令牌缺少 SESSION_SECRET");
  // 成片可能渲染数小时；有效期也纳入签名，预览仍沿用十分钟令牌。
  const expiresAt = purpose === "render" ? String(Number(issuedAt) + MAX_RENDER_TOKEN_TTL_MS) : undefined;
  const payload = expiresAt ? `${jobId}:${issuedAt}:${expiresAt}` : `${jobId}:${issuedAt}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return expiresAt ? `${issuedAt}.${expiresAt}.${signature}` : `${issuedAt}.${signature}`;
};

export const verifyRenderArtifactToken = (jobId: string, token: string | null) => {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2 && parts.length !== 3) return false;
  const [issuedAt] = parts;
  const expiresAt = parts.length === 3 ? parts[1] : undefined;
  const providedSignature = parts.at(-1);
  const timestamp = Number(issuedAt);
  const secret = renderSecret();
  if (!secret || !/^\d+$/.test(issuedAt) || !providedSignature) return false;
  const now = Date.now();
  if (now < timestamp) return false;
  if (expiresAt !== undefined) {
    const expiry = Number(expiresAt);
    if (!/^\d+$/.test(expiresAt) || !Number.isSafeInteger(expiry) || expiry <= timestamp ||
      expiry - timestamp > MAX_RENDER_TOKEN_TTL_MS || now > expiry) return false;
  } else if (now - timestamp > 10 * 60 * 1000) return false;
  const payload = expiresAt ? `${jobId}:${issuedAt}:${expiresAt}` : `${jobId}:${issuedAt}`;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const actual = Buffer.from(providedSignature);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
};

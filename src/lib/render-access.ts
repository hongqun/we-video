import {createHmac, timingSafeEqual} from "node:crypto";

const renderSecret = () => process.env.SESSION_SECRET?.trim() ?? "";

export const createRenderArtifactToken = (jobId: string) => {
  // Keep the URL stable across snapshot polling while limiting exposure to a short window.
  const issuedAt = (Math.floor(Date.now() / (5 * 60 * 1000)) * 5 * 60 * 1000).toString();
  const secret = renderSecret();
  if (!secret) throw new Error("渲染音频访问令牌缺少 SESSION_SECRET");
  const payload = `${jobId}:${issuedAt}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${issuedAt}.${signature}`;
};

export const verifyRenderArtifactToken = (jobId: string, token: string | null) => {
  if (!token) return false;
  const [issuedAt, providedSignature] = token.split(".");
  const timestamp = Number(issuedAt);
  const secret = renderSecret();
  if (!secret || !/^\d+$/.test(issuedAt) || !providedSignature) return false;
  if (Date.now() - timestamp < 0 || Date.now() - timestamp > 10 * 60 * 1000) return false;
  const payload = `${jobId}:${issuedAt}`;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const actual = Buffer.from(providedSignature);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
};

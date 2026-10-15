import {createHash} from "node:crypto";
import {promises as fs} from "node:fs";
import path from "node:path";

export type LogoResolutionStatus = "resolved" | "fallback" | "missing";
export type LogoSource = "official" | "simple-icons" | "github" | "favicon" | "fallback";
export type LogoAsset = {
  brandId: string;
  label: string;
  localPath: string;
  source: LogoSource;
  status: LogoResolutionStatus;
  sha256?: string;
  sourceUrl?: string;
  resolvedUrl?: string;
  license?: string;
};
export type LogoRequest = {label: string; brandId?: string; entityType: "brand"};

const BRAND_ALIASES: Record<string, string> = {
  chatgpt: "chatgpt", "chat gpt": "chatgpt", canva: "canva", gemini: "gemini", claude: "claude", grok: "grok",
  "google translate": "google-translate", quillbot: "quillbot", quizlet: "quizlet", chegg: "chegg",
};
const SAFE_BRAND_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SIMPLE_ICONS_HOST = "cdn.simpleicons.org";
const normalize = (value: string) => value.trim().toLowerCase().replace(/[®™]/g, "");
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");

export const resolveBrandId = (label: string) => {
  const value = BRAND_ALIASES[normalize(label)] ?? normalize(label).replace(/[^a-z0-9]+/g, "-");
  return SAFE_BRAND_ID_RE.test(value) ? value : "brand";
};
export const safeBrandId = (brandId: string | undefined, label: string) => {
  const value = normalize(brandId ?? "");
  return SAFE_BRAND_ID_RE.test(value) ? value : resolveBrandId(label);
};
export const logoAssetPath = (publicDir: string, brandId: string) => path.join(publicDir, "assets", "logos", `${brandId}.svg`);

export const resolveLocalLogo = async (publicDir: string, label: string): Promise<LogoAsset> => {
  const brandId = resolveBrandId(label);
  try {
    const bytes = await fs.readFile(logoAssetPath(publicDir, brandId));
    return {brandId, label, localPath: `assets/logos/${brandId}.svg`, source: "official", status: "resolved", sha256: sha256(bytes)};
  } catch {
    return {brandId, label, localPath: "", source: "fallback", status: "fallback"};
  }
};
export const logoManifestEntry = (label: string, localPath: string, source: LogoSource = "official"): LogoAsset => ({brandId: resolveBrandId(label), label, localPath, source, status: localPath ? "resolved" : "fallback"});

const sanitizeSvg = (value: string) => {
  if (value.length > 250_000 || !/<svg\b/i.test(value)) return null;
  const sanitized = value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/(?:href|xlink:href)\s*=\s*(["'])[^"']*\1/gi, "")
    .replace(/url\s*\(\s*["']?(?:https?:|data:|javascript:)[^)]*\)/gi, "");
  return sanitized.includes("<svg") ? sanitized : null;
};
const isSimpleIconsUrl = (value: string) => {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === SIMPLE_ICONS_HOST; } catch { return false; }
};

const fetchLogo = async (brandId: string): Promise<{bytes: Buffer; source: LogoSource; sourceUrl: string; resolvedUrl: string} | null> => {
  // Asset bytes only come from this fixed, allow-listed endpoint. Never fetch a
  // URL found in arbitrary HTML or from a search result.
  const resolvedUrl = `https://${SIMPLE_ICONS_HOST}/${brandId}`;
  try {
    const response = await fetch(resolvedUrl, {redirect: "error", signal: AbortSignal.timeout(5000)});
    if (!response.ok || !isSimpleIconsUrl(response.url) || Number(response.headers.get("content-length") ?? 0) > 250_000) return null;
    const svg = sanitizeSvg(await response.text());
    return svg ? {bytes: Buffer.from(svg, "utf8"), source: "simple-icons", sourceUrl: resolvedUrl, resolvedUrl} : null;
  } catch { return null; }
};

type StoredMediaManifest = {logos?: LogoAsset[]};
const readStoredAssets = async (outputDir: string) => {
  try {
    const payload = JSON.parse(await fs.readFile(path.join(outputDir, "media", "media-manifest.json"), "utf8")) as StoredMediaManifest;
    return new Map((payload.logos ?? []).map((asset) => [asset.brandId, asset]));
  } catch { return new Map<string, LogoAsset>(); }
};

/** Resolve external bytes before rendering, then render only frozen local assets. */
export const resolveLogoRequests = async (requests: LogoRequest[], outputDir: string) => {
  const logosDir = path.join(outputDir, "media", "logos");
  await fs.mkdir(logosDir, {recursive: true});
  const storedAssets = await readStoredAssets(outputDir);
  const unique = new Map<string, LogoRequest>();
  for (const request of requests) {
    const brandId = safeBrandId(request.brandId, request.label);
    if (!unique.has(brandId)) unique.set(brandId, {...request, brandId});
  }
  const assets: LogoAsset[] = [];
  for (const request of unique.values()) {
    const brandId = request.brandId!;
    const target = path.join(logosDir, `${brandId}.svg`);
    try {
      const existing = await fs.readFile(target);
      const stored = storedAssets.get(brandId);
      // A file without its ledger predates provenance tracking. Do not present
      // it as a verified source; refetch it into the current manifest instead.
      if (!stored) {
        await fs.unlink(target);
        throw new Error("缺少 Logo 来源记录");
      }
      assets.push({brandId, label: request.label, localPath: `artifact://media/logos/${brandId}.svg`, source: stored?.source ?? "fallback", status: "resolved", sha256: sha256(existing), sourceUrl: stored?.sourceUrl, resolvedUrl: stored?.resolvedUrl, license: stored?.license});
      continue;
    } catch { /* resolve below */ }
    const resolved = await fetchLogo(brandId);
    if (!resolved) { assets.push({brandId, label: request.label, localPath: "", source: "fallback", status: "fallback"}); continue; }
    await fs.writeFile(target, resolved.bytes);
    assets.push({brandId, label: request.label, localPath: `artifact://media/logos/${brandId}.svg`, source: resolved.source, status: "resolved", sha256: sha256(resolved.bytes), sourceUrl: resolved.sourceUrl, resolvedUrl: resolved.resolvedUrl});
  }
  const ledger = new Map(storedAssets);
  for (const asset of assets) ledger.set(asset.brandId, asset);
  await fs.writeFile(path.join(outputDir, "media", "media-manifest.json"), `${JSON.stringify({logos: [...ledger.values()]}, null, 2)}\n`, "utf8");
  return assets;
};

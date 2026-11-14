import {EXPLAINER_MAX_SPEED} from "../../remotion/templates/handdraw-explainer-schema";
import {randomUUID} from "node:crypto";
import {promises as fs} from "node:fs";
import path from "node:path";
import {z} from "zod";
import {atomicWriteJson, jobDir, readJson} from "../jobs";
import {BailianDrawingClient, ExplainerMediaError, ExplainerReviewError} from "./bailian";
import {explainerAsset, explainerDigest, probeExplainerLine} from "./compiler";
import type {ExplainerContext} from "./context";
import {loadExplainerContext} from "./context";
import {assertExplainerRequest, readExplainerArtworks, withExplainerLock, writeExplainerArtworks, type ExplainerArtwork} from "./store";

export const artworkInputSchema = z.object({id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), brief: z.string().trim().min(10).max(3000), linePrompt: z.string().trim().min(20).max(6000), colorPrompt: z.string().trim().min(10).max(4000), reuseLineFrom: z.string().uuid().optional()}).strict();
type Settings = {imageModel: string; visionModel: string};
type Progress = (text: string) => Promise<unknown>;
const imageGuidance = "白色背景，主体清晰可识别，连续干净的纯黑轮廓；禁止文字、水印、灰色阴影、排线、纹理、渐变和大片黑色填充。各语义部位可辨认，接触与因果关系必须画对。少量闭合轮廓及必要细节，线条复杂度符合绘制预算。";
const colorGuidance = "以上传线稿为唯一构图：每条黑线的位置、粗细和形状保持不变，只在已有轮廓内添加少量平涂颜色。保持白色背景，不新增、移除或移动任何物体、线条、文字、阴影或纹理。";
const reviewContext = (context: ExplainerContext) => JSON.stringify({spokenText: context.scene.spokenText, title: context.scene.content.title, style: context.style});
type LineReview = Awaited<ReturnType<BailianDrawingClient["review"]>> & {lineHash?: string; contextFingerprint?: string};

// 只暴露本镜头近期制作记录；上色失败后，模型可以显式复用已通过审核的线稿。
export const listExplainerAttempts = async (jobId: string, context: ExplainerContext) => {
  const base = `handdraw-explainers/${context.sceneId}/artwork`;
  const entries = await fs.readdir(path.join(jobDir(jobId), base), {withFileTypes: true}).catch((error: NodeJS.ErrnoException) => {if (error.code === "ENOENT") return []; throw error;});
  const records = await Promise.all(entries.filter((item) => item.isDirectory() && z.string().uuid().safeParse(item.name).success).map(async (entry) => {
    const directory = path.join(jobDir(jobId), base, entry.name);
    try {
      const brief = await readJson<{id: string; brief: string; contextFingerprint: string}>(path.join(directory, "brief.json"));
      const review = await readJson<LineReview>(path.join(directory, "line-review.json")).catch(() => null);
      const colorReview = await readJson<LineReview>(path.join(directory, "color-review.json")).catch(() => null);
      const failure = await readJson<{message: string; stage: string}>(path.join(directory, "color-review-error.json")).catch(() => null);
      const canReuseLine = Boolean(review?.pass && !review.issues.length && review.contextFingerprint === context.fingerprint && review.lineHash === explainerDigest(await fs.readFile(path.join(directory, "line.png"))));
      return {version: entry.name, id: brief.id, brief: brief.brief, canReuseLine, canResume: canReuseLine && (!colorReview || (colorReview.pass && !colorReview.issues.length)), reviewFailure: failure?.message, hasColor: await fs.access(path.join(directory, "color.png")).then(() => true).catch(() => false), createdAt: (await fs.stat(path.join(directory, "brief.json"))).mtimeMs};
    } catch {return null;}
  }));
  return records.filter((record) => record !== null).sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
};

const saveArtwork = (jobId: string, context: ExplainerContext, requestId: string, artwork: ExplainerArtwork) => withExplainerLock(jobId, context.sceneId, async () => {
  await assertExplainerRequest(jobId, context.sceneId, requestId);
  if ((await loadExplainerContext(jobId, context.sceneId)).context.fingerprint !== context.fingerprint) throw new ExplainerMediaError("镜头上下文已改变，请重新制作");
  const existing = await readExplainerArtworks(jobId, context.sceneId);
  await writeExplainerArtworks(jobId, context.sceneId, [...existing.filter((item) => item.id !== artwork.id), artwork]);
  return artwork;
});

// 报告解析失败单独留诊断；画面不合格的报告仍保存，便于 Agent 有针对性修改。
const checkedReview = async (directory: string, stage: string, client: BailianDrawingClient, model: string, prompt: string, images: Buffer[], signal: AbortSignal) => {
  try {
    const review = await client.review(model, prompt, images, signal);
    await atomicWriteJson(path.join(directory, `${stage}-review.json`), review);
    await fs.rm(path.join(directory, `${stage}-review-error.json`), {force: true});
    return review;
  } catch (error) {
    if (error instanceof ExplainerMediaError) await atomicWriteJson(path.join(directory, `${stage}-review-error.json`), {stage, message: error.message, diagnostic: error instanceof ExplainerReviewError ? error.diagnostic : undefined});
    throw error;
  }
};

// 按版本继续失败阶段；已有彩图只做复核，不再调用生图，也不消耗新图预算。
export const resumeExplainerArtwork = async (jobId: string, context: ExplainerContext, requestId: string, version: string, settings: Settings, client: BailianDrawingClient, signal: AbortSignal, progress: Progress) => {
  z.string().uuid().parse(version);
  await assertExplainerRequest(jobId, context.sceneId, requestId);
  if ((await loadExplainerContext(jobId, context.sceneId)).context.fingerprint !== context.fingerprint) throw new ExplainerMediaError("镜头上下文已改变，请重新制作");
  const relative = `handdraw-explainers/${context.sceneId}/artwork/${version}`;
  const directory = await explainerAsset(jobId, `${relative}/brief.json`).then((file) => path.dirname(file));
  const brief = await readJson<{id: string; brief: string; colorPrompt: string; contextFingerprint: string}>(path.join(directory, "brief.json"));
  const line = await fs.readFile(await explainerAsset(jobId, `${relative}/line.png`));
  const lineReview = await readJson<LineReview>(path.join(directory, "line-review.json"));
  if (brief.contextFingerprint !== context.fingerprint || lineReview.contextFingerprint !== context.fingerprint || !lineReview.pass || lineReview.issues.length || lineReview.lineHash !== explainerDigest(line)) throw new ExplainerMediaError("该版本线稿尚未通过当前镜头审核，请重新制作");
  let color: Buffer;
  const colorExists = await fs.access(path.join(directory, "color.png")).then(() => true).catch(() => false);
  if (colorExists) {
    const previous = await readJson<LineReview>(path.join(directory, "color-review.json")).catch(() => null);
    if (previous && (!previous.pass || previous.issues.length)) throw new ExplainerMediaError(`该彩图已明确复核不通过，请修改方案：${previous.issues.join("；") || previous.evidence}`);
    color = await fs.readFile(await explainerAsset(jobId, `${relative}/color.png`));
  } else {
    await progress(`继续为 ${brief.id} 上色`);
    color = await client.generate(settings.imageModel, brief.colorPrompt, signal, line);
    await fs.writeFile(path.join(directory, "color.png"), color);
  }
  await progress(`复核 ${brief.id} 已保存的上色图`);
  const review = await checkedReview(directory, "color", client, settings.visionModel, `第一张是线稿，第二张是上色图。检查是否只增加平涂颜色并保留全部线条、构图和语义。以第二张图给出语义部位框。简报：${brief.brief}。镜头：${reviewContext(context)}`, [line, color], signal);
  if (!review.pass || review.issues.length) throw new ExplainerMediaError(`上色复核未通过：${review.issues.join("；") || review.evidence}。请修改上色方案，不要重复复核同一画面。`);
  return saveArtwork(jobId, context, requestId, {id: brief.id, version, contextFingerprint: context.fingerprint, linePath: `${relative}/line.png`, colorPath: `${relative}/color.png`, lineHash: explainerDigest(line), colorHash: explainerDigest(color), evidence: review.evidence, parts: review.parts});
};

// 先落盘简报与完整提示词，再调用生图；每轮使用独立目录，失败也保留线稿和审核记录。
export const createExplainerArtwork = async (jobId: string, context: ExplainerContext, requestId: string, raw: unknown, settings: Settings, client: BailianDrawingClient, signal: AbortSignal, progress: Progress, measure: typeof probeExplainerLine = probeExplainerLine) => {
  const input = artworkInputSchema.parse(raw);
  const version = randomUUID();
  const relative = `handdraw-explainers/${context.sceneId}/artwork/${version}`;
  const directory = path.join(jobDir(jobId), relative);
  await fs.mkdir(directory, {recursive: true});
  const budgetMs = Math.max(0, Math.min(context.durationInFrames / 30 * .7, context.durationInFrames / 30 - 1) * 1000);
  const linePrompt = `${input.linePrompt}\n${imageGuidance}\n本镜头全部绘制最多 ${(budgetMs / 1000).toFixed(1)} 秒，尚需预留上色和文字，请主动简化轮廓。`;
  const colorPrompt = `${input.colorPrompt}\n${colorGuidance}`;
  let reused: {line: Buffer; review: LineReview; brief: string; linePrompt: string} | undefined;
  if (input.reuseLineFrom) {
    const source = `handdraw-explainers/${context.sceneId}/artwork/${input.reuseLineFrom}`;
    const brief = await readJson<{id: string; brief: string; linePrompt: string; contextFingerprint: string}>(await explainerAsset(jobId, `${source}/brief.json`));
    const review = await readJson<LineReview>(await explainerAsset(jobId, `${source}/line-review.json`));
    const line = await fs.readFile(await explainerAsset(jobId, `${source}/line.png`));
    if (brief.id !== input.id || review.contextFingerprint !== context.fingerprint || !review.pass || review.issues.length || review.lineHash !== explainerDigest(line)) throw new ExplainerMediaError("指定线稿尚未通过当前镜头审核或已被替换，请重新生成线稿");
    reused = {line, review, brief: brief.brief, linePrompt: brief.linePrompt};
  }
  await atomicWriteJson(path.join(directory, "brief.json"), {id: input.id, contextFingerprint: context.fingerprint, brief: input.brief, linePrompt: reused?.linePrompt ?? linePrompt, colorPrompt, reusedLineFrom: input.reuseLineFrom, imageModel: settings.imageModel, visionModel: settings.visionModel});
  await progress(`${reused ? "复用" : "生成"} ${input.id} 的线稿`);
  const line = reused?.line ?? await client.generate(settings.imageModel, linePrompt, signal);
  await fs.writeFile(path.join(directory, "line.png"), line);
  const measurement = await measure(path.join(directory, "line.png"), signal);
  await atomicWriteJson(path.join(directory, "line-budget.json"), measurement);
  if (measurement.minimumLineMs > budgetMs * EXPLAINER_MAX_SPEED) throw new ExplainerMediaError(`线稿至少需要 ${(measurement.minimumLineMs / 1000).toFixed(1)} 秒描线，即使 ${EXPLAINER_MAX_SPEED} 倍速也超过本镜头预算；请减少轮廓后重新生成，尚未调用上色`);
  await progress(`检查 ${input.id} 的线稿与语义部位`);
  const lineReview = reused?.brief === input.brief ? reused.review : await checkedReview(directory, "line", client, settings.visionModel, `检查这张线稿是否遵循简报，物体是否能识别，动作与因果是否清楚，是否具有连续轮廓且没有文字、纹理、大片黑色。简报：${input.brief}。镜头：${reviewContext(context)}`, [line], signal);
  await atomicWriteJson(path.join(directory, "line-review.json"), {...lineReview, lineHash: explainerDigest(line), contextFingerprint: context.fingerprint});
  if (!lineReview.pass || lineReview.issues.length) throw new ExplainerMediaError(`线稿复核未通过：${lineReview.issues.join("；") || lineReview.evidence}。线稿已保留，尚未调用上色。`);
  await progress(`为 ${input.id} 上色`);
  const color = await client.generate(settings.imageModel, colorPrompt, signal, line);
  await fs.writeFile(path.join(directory, "color.png"), color);
  await progress(`复核 ${input.id} 的上色图`);
  const review = await checkedReview(directory, "color", client, settings.visionModel, `第一张是线稿，第二张是上色图。检查第二张是否只增加平涂颜色、保留全部线条、构图和语义，是否忠实表达简报。以第二张图给出语义部位框。简报：${input.brief}。镜头：${reviewContext(context)}`, [line, color], signal);
  await atomicWriteJson(path.join(directory, "color-review.json"), review);
  if (!review.pass || review.issues.length) throw new ExplainerMediaError(`上色复核未通过：${review.issues.join("；") || review.evidence}。本轮素材已保留。`);
  return saveArtwork(jobId, context, requestId, {id: input.id, version, contextFingerprint: context.fingerprint, linePath: `${relative}/line.png`, colorPath: `${relative}/color.png`, lineHash: explainerDigest(line), colorHash: explainerDigest(color), evidence: review.evidence, parts: review.parts});
};

export const reviewExistingArtwork = async (jobId: string, context: ExplainerContext, requestId: string, id: string, settings: Settings, client: BailianDrawingClient, signal: AbortSignal) => {
  const artwork = (await readExplainerArtworks(jobId, context.sceneId)).find((item) => item.id === id);
  if (!artwork) throw new ExplainerMediaError("没有这份已完成插画");
  const line = await fs.readFile(await explainerAsset(jobId, artwork.linePath)), color = await fs.readFile(await explainerAsset(jobId, artwork.colorPath));
  if (explainerDigest(line) !== artwork.lineHash || explainerDigest(color) !== artwork.colorHash) throw new ExplainerMediaError("插画内容已被替换，请重新生成");
  const review = await client.review(settings.visionModel, `检查既有线稿与彩图能否在当前镜头和风格中复用，是否保持线条与构图、符合口播事实、没有文字与纹理。以彩图给出语义部位。镜头：${reviewContext(context)}`, [line, color], signal);
  if (!review.pass || review.issues.length) throw new ExplainerMediaError(`既有插画不适合当前镜头：${review.issues.join("；") || review.evidence}`);
  return saveArtwork(jobId, context, requestId, {...artwork, contextFingerprint: context.fingerprint, evidence: review.evidence, parts: review.parts});
};

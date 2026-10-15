import {z} from "zod";
import {mathFormulaIdSchema} from "../math/formulas";
import {mathOutroVariantSchema} from "./math-outro-variants";

export const mathManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  contentMode: z.literal("math"),
  jobId: z.string().min(1),
  revision: z.number().int().positive().default(1),
  contentProfile: z.object({accountId: z.string(), seriesId: z.string(), accountVersion: z.string(), seriesVersion: z.string()}),
  outroVariant: mathOutroVariantSchema.default("orbit-trace"),
  title: z.string().min(1),
  summary: z.string().min(1),
  video: z.object({width: z.literal(1080), height: z.union([z.literal(1260), z.literal(1920)]), fps: z.literal(30), outroDurationMs: z.literal(3000)}),
  formula: z.object({id: mathFormulaIdSchema, latex: z.string().min(1), parameters: z.record(z.string(), z.number()), plot: z.object({xMin: z.number(), xMax: z.number(), yMin: z.number(), yMax: z.number(), drawDurationMs: z.number().int().positive()})}),
  musicSrc: z.string().min(1),
  brand: z.object({logoSrc: z.string().min(1), title: z.string().min(1), subtitle: z.string().min(1), label: z.string().min(1).optional(), downloadPrefix: z.string().min(1).optional()}),
});

export type MathRenderManifest = z.infer<typeof mathManifestSchema>;
export const isMathManifest = (value: unknown): value is MathRenderManifest => mathManifestSchema.safeParse(value).success;

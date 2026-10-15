import {z} from "zod";

const visualImagePointSchema = z.object({x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1)}).strict();

// 多边形 schema 独立于渲染逻辑，供资源 API 和 Remotion 模板共享，避免服务端循环初始化。
export const visualImagePolygonSchema = z.object({
  text: z.string().trim().min(1),
  points: z.array(visualImagePointSchema).min(3).max(64),
}).strict().superRefine((polygon, context) => {
  const cross = (a: {x: number; y: number}, b: {x: number; y: number}, c: {x: number; y: number}) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const area = polygon.points.reduce((sum, point, index) => {
    const next = polygon.points[(index + 1) % polygon.points.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
  if (Math.abs(area) < 1e-6) context.addIssue({code: "custom", path: ["points"], message: "多边形面积不能为零"});
  for (let first = 0; first < polygon.points.length; first += 1) {
    const firstNext = (first + 1) % polygon.points.length;
    for (let second = first + 1; second < polygon.points.length; second += 1) {
      const secondNext = (second + 1) % polygon.points.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      const a = polygon.points[first]!; const b = polygon.points[firstNext]!;
      const c = polygon.points[second]!; const d = polygon.points[secondNext]!;
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) context.addIssue({code: "custom", path: ["points"], message: "多边形边线不能相交"});
    }
  }
});

export const visualImageDataSchema = z.object({
  imagePath: z.string().trim().min(1),
  imageWidth: z.number().int().positive(), imageHeight: z.number().int().positive(),
  polygons: z.array(visualImagePolygonSchema),
}).strip();

export type VisualImagePolygon = z.infer<typeof visualImagePolygonSchema>;
export type VisualImageData = z.infer<typeof visualImageDataSchema>;

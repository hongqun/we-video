import {z} from "zod";

export const mathFormulaIdSchema = z.enum([
  "polar", "lissajous", "sine", "rose", "butterfly", "cardioid", "double-heart",
  "limacon", "trifolium", "quadrifolium", "lemniscate", "cannabis", "chrysanthemum", "sunflower",
  "astroid", "nephroid", "deltoid", "epitrochoid", "hypotrochoid", "cycloid", "involute", "tractrix", "pentaspoid", "gear",
  "harmonograph", "amplitude-modulated", "frequency-modulated", "beat-wave", "parametric-heart", "algebraic-heart", "parabolic-heart", "teardrop-heart",
  "archimedean-spiral", "logarithmic-spiral", "euler-spiral", "fermat-spiral", "lituus", "hyperbolic-spiral", "poinsot-spiral", "sinusoidal-spiral", "cotes-spiral", "golden-spiral",
  "superellipse", "gielis-superformula", "superastroid", "concave-square", "squircle",
  "ellipse", "equilateral-hyperbola", "catenary", "witch-of-agnesi", "trisectrix", "cissoid", "conchoid", "cayley-sextic", "gerono-lemniscate", "cassini-oval", "cruciform", "devils-curve", "kampyle", "tschirnhausen-cubic", "bean", "dumbbell", "bullet-nose", "teardrop", "fish", "bow", "talbot", "freeth-nephroid", "watt", "inner-loop-limacon", "convex-limacon",
  "gaussian", "damped-sine", "sinc", "logistic", "fresnel", "bessel-j0", "sech-envelope", "wave-packet", "tangent-wave", "dual-sine",
  "reuleaux-triangle", "reuleaux-pentagon", "kepler-orbit", "trefoil-projection", "figure-eight-projection", "bicuspid", "spiral-parabola", "crown", "teardrop-cycloid", "hub",
  "starburst", "gear-astroid", "sinusoidal-ring", "sextifolium", "cubic-bezier", "elliptic-phase", "spiral-astroid", "dimpled-limacon", "multi-frequency", "polar-heart-leaf",
]);
export type MathFormulaId = z.infer<typeof mathFormulaIdSchema>;

export type Point = {x: number; y: number};
export type MathFormulaParameters = Record<string, number>;

export type FormulaDefinition = {
  id: MathFormulaId;
  name: string;
  category: string;
  latex: string;
  introduction: string;
  parameterDefaults: MathFormulaParameters;
  parameterRanges: Record<string, {min: number; max: number}>;
  plot: {xMin: number; xMax: number; yMin: number; yMax: number};
  points: (parameters: MathFormulaParameters) => Point[];
  dynamicLatex: (parameters: MathFormulaParameters, progress: number) => string;
};

const sample = (count: number, callback: (value: number) => Point): Point[] => {
  const points = Array.from({length: count + 1}, (_, index) => callback(index / count));
  const finite = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  return finite.length >= 2 ? finite : [{x: 0, y: 0}, {x: 0.0001, y: 0}];
};

const polar = (theta: number, radius: number): Point => ({x: radius * Math.cos(theta), y: radius * Math.sin(theta)});
const parametric = (count: number, callback: (t: number) => Point) => sample(count, (progress) => callback(progress * Math.PI * 2));
const denominatorForRatio = (value: number): number => {
  let best = 1;
  let error = Number.POSITIVE_INFINITY;
  for (let denominator = 1; denominator <= 24; denominator += 1) {
    const candidateError = Math.abs(value * denominator - Math.round(value * denominator));
    if (candidateError < error) { error = candidateError; best = denominator; }
  }
  return best;
};

const definitions: FormulaDefinition[] = [
  {
    id: "polar",
    name: "极坐标花瓣曲线",
    category: "极坐标",
    latex: String.raw`r = a\sin(b\theta) + c`,
    introduction: "这是一条极坐标参数曲线：a 控制径向起伏幅度，b 控制起伏的周期密度，c 改变整体半径。调整这些参数，可以直观看到花瓣状轮廓的大小与疏密变化。",
    parameterDefaults: {a: 4, b: 9.6, c: 10},
    parameterRanges: {a: {min: 1, max: 8}, b: {min: 2, max: 14}, c: {min: 6, max: 14}},
    plot: {xMin: -15, xMax: 15, yMin: -15, yMax: 15},
    points: ({a, b, c}) => sample(1800, (progress) => {
      const theta = progress * 40;
      const radius = c + a * Math.sin(b * theta);
      return {x: radius * Math.cos(theta), y: radius * Math.sin(theta)};
    }),
    dynamicLatex: ({a, b, c}, progress) => String.raw`r = ${a.toFixed(1)}\sin(${b.toFixed(1)}\theta) + ${c.toFixed(1)},\quad \theta = ${(progress * 40).toFixed(2)}`,
  },
  {
    id: "lissajous",
    name: "利萨如曲线",
    category: "振动与轨迹",
    latex: String.raw`x = \sin(at + \frac{\pi}{2}),\quad y = \sin(bt)`,
    introduction: "利萨如曲线由两个相互垂直的正弦振动合成。a 与 b 的频率比决定轨迹的回环、对称性和复杂程度，参数接近整数比时，曲线会形成清晰的闭合图形。",
    parameterDefaults: {a: 3, b: 4},
    parameterRanges: {a: {min: 1, max: 7}, b: {min: 1, max: 8}},
    plot: {xMin: -1.1, xMax: 1.1, yMin: -1.1, yMax: 1.1},
    points: ({a, b}) => sample(1400, (progress) => {
      const t = progress * Math.PI * 2;
      return {x: Math.sin(a * t + Math.PI / 2), y: Math.sin(b * t)};
    }),
    dynamicLatex: ({a, b}, progress) => String.raw`x = \sin(${a.toFixed(0)}t + \frac{\pi}{2}),\quad y = \sin(${b.toFixed(0)}t),\quad t = ${(progress * Math.PI * 2).toFixed(2)}`,
  },
  {
    id: "sine",
    name: "正弦波",
    category: "周期函数",
    latex: String.raw`y = A\sin(\omega x + \phi)`,
    introduction: "正弦波是周期函数的典型图形：A 控制振幅，ω 控制周期密度，φ 控制相位偏移。三个参数分别改变波形的高度、疏密和水平位置。",
    parameterDefaults: {amplitude: 1, frequency: 1, phase: 0},
    parameterRanges: {amplitude: {min: 0.5, max: 2}, frequency: {min: 0.5, max: 3}, phase: {min: -3.14, max: 3.14}},
    plot: {xMin: -Math.PI * 2, xMax: Math.PI * 2, yMin: -2.2, yMax: 2.2},
    points: ({amplitude, frequency, phase}) => sample(1200, (progress) => {
      const x = progress * Math.PI * 4 - Math.PI * 2;
      return {x, y: amplitude * Math.sin(frequency * x + phase)};
    }),
    dynamicLatex: ({amplitude, frequency, phase}, progress) => String.raw`y = ${amplitude.toFixed(1)}\sin(${frequency.toFixed(1)}x ${phase >= 0 ? "+" : "-"} ${Math.abs(phase).toFixed(2)}),\quad x = ${(progress * Math.PI * 4 - Math.PI * 2).toFixed(2)}`,
  },
  {
    id: "rose",
    name: "玫瑰曲线",
    category: "极坐标",
    latex: String.raw`r = a\cos(n\theta)`,
    introduction: "玫瑰曲线是一类极坐标曲线：a 控制整体尺度，n 决定径向变化的频率以及图形的瓣状对称性。动画通过改变绘制进度，展示曲线如何逐步闭合。",
    parameterDefaults: {amplitude: 8, petals: 4},
    parameterRanges: {amplitude: {min: 4, max: 10}, petals: {min: 2, max: 8}},
    plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10},
    points: ({amplitude, petals}) => sample(1600, (progress) => {
      const theta = progress * Math.PI * 2;
      const radius = amplitude * Math.cos(petals * theta);
      return {x: radius * Math.cos(theta), y: radius * Math.sin(theta)};
    }),
    dynamicLatex: ({amplitude, petals}, progress) => String.raw`r = ${amplitude.toFixed(1)}\cos(${petals.toFixed(0)}\theta),\quad \theta = ${(progress * Math.PI * 2).toFixed(2)}`,
  },
  {
    id: "butterfly",
    name: "蝴蝶曲线",
    category: "极坐标与自然形态",
    latex: String.raw`r = e^{\cos\theta} - 2\cos(4\theta) + \sin^5\!\left(\frac{\theta}{12}\right)`,
    introduction: "蝴蝶曲线由 Fay 提出的极坐标表达式生成：指数项、四重角频项和缓慢变化的五次正弦项共同塑造出高度对称、具有翅膀与触角般细节的蝴蝶形态。",
    parameterDefaults: {thetaSpan: Math.PI * 12},
    parameterRanges: {thetaSpan: {min: Math.PI * 12, max: Math.PI * 12}},
    plot: {xMin: -4.5, xMax: 4.5, yMin: -4.5, yMax: 4.5},
    points: ({thetaSpan}) => sample(2600, (progress) => {
      const theta = progress * thetaSpan;
      const radius = Math.exp(Math.cos(theta)) - 2 * Math.cos(4 * theta) + Math.pow(Math.sin(theta / 12), 5);
      return {x: radius * Math.cos(theta), y: radius * Math.sin(theta)};
    }),
    dynamicLatex: ({thetaSpan}, progress) => String.raw`r = e^{\cos\theta} - 2\cos(4\theta) + \sin^5\!\left(\frac{\theta}{12}\right),\quad 0\le\theta\le ${(thetaSpan * progress).toFixed(2)}`,
  },
  {
    id: "cardioid",
    name: "心形线",
    category: "极坐标与经典曲线",
    latex: String.raw`r = a(1 + \cos\theta)`,
    introduction: "心形线是一条经典的极坐标曲线：a 控制整体尺度，1 + cosθ 让曲线在原点形成平滑单尖角，并沿对称轴展开为饱满的心形轮廓。",
    parameterDefaults: {a: 8},
    parameterRanges: {a: {min: 4, max: 10}},
    plot: {xMin: -1, xMax: 17, yMin: -9, yMax: 9},
    points: ({a}) => sample(1800, (progress) => {
      const theta = progress * Math.PI * 2;
      const radius = a * (1 + Math.cos(theta));
      return {x: radius * Math.cos(theta), y: radius * Math.sin(theta)};
    }),
    dynamicLatex: ({a}, progress) => String.raw`r = ${a.toFixed(1)}(1 + \cos\theta),\quad 0\le\theta\le ${(progress * Math.PI * 2).toFixed(2)}`,
  },
  {
    id: "double-heart",
    name: "极坐标双重心形线",
    category: "极坐标与复合心形",
    latex: String.raw`r = \frac{\sin\theta\sqrt{|\cos\theta|}}{\sin\theta + \frac{7}{5}} - 2\sin\theta + 2`,
    introduction: "极坐标双重心形线将带绝对值的根式项、非线性分式项与正弦偏移组合在一起，在完整角度域内形成左右呼应的双重心形轮廓。",
    parameterDefaults: {thetaSpan: Math.PI * 2},
    parameterRanges: {thetaSpan: {min: Math.PI * 2, max: Math.PI * 2}},
    plot: {xMin: -4, xMax: 4, yMin: -3, yMax: 3},
    points: ({thetaSpan}) => sample(2200, (progress) => {
      const theta = progress * thetaSpan;
      const sine = Math.sin(theta);
      const cosine = Math.cos(theta);
      const radius = (sine * Math.sqrt(Math.abs(cosine))) / (sine + 7 / 5) - 2 * sine + 2;
      return {x: radius * cosine, y: radius * sine};
    }),
    dynamicLatex: ({thetaSpan}, progress) => String.raw`r = \frac{\sin\theta\sqrt{|\cos\theta|}}{\sin\theta + \frac{7}{5}} - 2\sin\theta + 2,\quad 0\le\theta\le ${(thetaSpan * progress).toFixed(2)}`,
  },
  {
    id: "limacon",
    name: "帕斯卡蜗线",
    category: "极坐标花卉与对称族",
    latex: String.raw`r = b + a\cos\theta`,
    introduction: "帕斯卡蜗线通过 a 与 b 的比例改变轮廓，可在凸形、平切和内环之间切换，是极坐标中最具代表性的形态族之一。",
    parameterDefaults: {a: 5, b: 4},
    parameterRanges: {a: {min: 2, max: 8}, b: {min: 2, max: 8}},
    plot: {xMin: -10, xMax: 10, yMin: -8, yMax: 8},
    points: ({a, b}) => parametric(1800, (theta) => polar(theta, b + a * Math.cos(theta))),
    dynamicLatex: ({a, b}, progress) => String.raw`r = ${b.toFixed(1)} + ${a.toFixed(1)}\cos\theta,\quad 0\le\theta\le ${(progress * Math.PI * 2).toFixed(2)}`,
  },
  {
    id: "trifolium",
    name: "三叶线",
    category: "极坐标花卉与对称族",
    latex: String.raw`r = a\cos(3\theta)`,
    introduction: "三叶线由三倍角频率形成三个完全对称的叶瓣，结构简洁但具有清晰的花卉辨识度。",
    parameterDefaults: {a: 8},
    parameterRanges: {a: {min: 4, max: 10}},
    plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10},
    points: ({a}) => parametric(1800, (theta) => polar(theta, a * Math.cos(3 * theta))),
    dynamicLatex: ({a}, progress) => String.raw`r = ${a.toFixed(1)}\cos(3\theta),\quad 0\le\theta\le ${(progress * Math.PI * 2).toFixed(2)}`,
  },
  {
    id: "quadrifolium",
    name: "四叶线",
    category: "极坐标花卉与对称族",
    latex: String.raw`r = a\cos(2\theta)`,
    introduction: "四叶线以九十度旋转对称展开四个优雅叶瓣，是极坐标花卉曲线中的经典例子。",
    parameterDefaults: {a: 8},
    parameterRanges: {a: {min: 4, max: 10}},
    plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10},
    points: ({a}) => parametric(1800, (theta) => polar(theta, a * Math.cos(2 * theta))),
    dynamicLatex: ({a}, progress) => String.raw`r = ${a.toFixed(1)}\cos(2\theta),\quad 0\le\theta\le ${(progress * Math.PI * 2).toFixed(2)}`,
  },
  {
    id: "lemniscate",
    name: "伯努利双连线",
    category: "极坐标花卉与对称族",
    latex: String.raw`r^2 = a^2\cos(2\theta)`,
    introduction: "伯努利双连线描绘经典的无穷大符号，两个环在原点相切并保持严格的中心对称。",
    parameterDefaults: {a: 8},
    parameterRanges: {a: {min: 4, max: 10}},
    plot: {xMin: -10, xMax: 10, yMin: -7, yMax: 7},
    points: ({a}) => parametric(2200, (theta) => {
      const cosine = Math.cos(2 * theta);
      const radius = a * Math.sign(cosine) * Math.sqrt(Math.abs(cosine));
      return polar(theta, radius);
    }),
    dynamicLatex: ({a}, progress) => String.raw`r^2 = ${a.toFixed(1)}^2\cos(2\theta),\quad 0\le\theta\le ${(progress * Math.PI * 2).toFixed(2)}`,
  },
  {
    id: "cannabis",
    name: "大麻叶曲线",
    category: "极坐标花卉与对称族",
    latex: String.raw`r=(1+0.9\cos8\theta)(1+0.1\cos\theta)(0.9+0.05\cos200\theta)(1+\sin\theta)`,
    introduction: "大麻叶曲线叠加多组不同频率的三角函数，形成复杂、细密而具有植物叶片质感的边缘。",
    parameterDefaults: {scale: 8, detail: 1},
    parameterRanges: {scale: {min: 5, max: 10}, detail: {min: 0.7, max: 1.2}},
    plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10},
    points: ({scale, detail}) => parametric(3600, (theta) => polar(theta, scale * (1 + 0.9 * Math.cos(8 * theta)) * (1 + 0.1 * Math.cos(theta)) * (0.9 + 0.05 * Math.cos(200 * detail * theta)) * (1 + Math.sin(theta)))),
    dynamicLatex: ({scale}, progress) => String.raw`r=${scale.toFixed(1)}(1+0.9\cos8\theta)(1+0.1\cos\theta)(0.9+0.05\cos200\theta)(1+\sin\theta),\quad \theta=${(progress * Math.PI * 2).toFixed(2)}`,
  },
  {
    id: "chrysanthemum",
    name: "菊花曲线",
    category: "极坐标花卉与对称族",
    latex: String.raw`r=5(1+\sin\frac{11\theta}{5})-4\sin^4(17\theta)\sin^5\frac{2\theta}{7}`,
    introduction: "菊花曲线将多个不同比例的正弦频率叠加，绘制出繁复而层次丰富的花朵纹理。",
    parameterDefaults: {scale: 1, detail: 1},
    parameterRanges: {scale: {min: 0.8, max: 1.2}, detail: {min: 0.8, max: 1.2}},
    plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10},
    points: ({scale, detail}) => parametric(3600, (theta) => polar(theta, scale * (5 * (1 + Math.sin(11 * detail * theta / 5)) - 4 * Math.pow(Math.sin(17 * detail * theta), 4) * Math.pow(Math.sin(2 * detail * theta / 7), 5)))),
    dynamicLatex: ({scale}, progress) => String.raw`r=${scale.toFixed(2)}[5(1+\sin\frac{11\theta}{5})-4\sin^4(17\theta)\sin^5\frac{2\theta}{7}],\quad \theta=${(progress * Math.PI * 2).toFixed(2)}`,
  },
  {
    id: "sunflower",
    name: "太阳花线",
    category: "极坐标花卉与对称族",
    latex: String.raw`r=a(1+b\sin(n\theta))`,
    introduction: "太阳花线在基圆周围均匀生成花瓣纹路，a、b 和 n 分别控制尺度、起伏幅度和花瓣密度。",
    parameterDefaults: {a: 6, b: 0.35, petals: 12},
    parameterRanges: {a: {min: 4, max: 9}, b: {min: 0.1, max: 0.7}, petals: {min: 4, max: 24}},
    plot: {xMin: -11, xMax: 11, yMin: -11, yMax: 11},
    points: ({a, b, petals}) => parametric(2200, (theta) => polar(theta, a * (1 + b * Math.sin(petals * theta)))),
    dynamicLatex: ({a, b, petals}, progress) => String.raw`r=${a.toFixed(1)}(1+${b.toFixed(2)}\sin(${petals.toFixed(0)}\theta)),\quad \theta=${(progress * Math.PI * 2).toFixed(2)}`,
  },
  {
    id: "astroid",
    name: "星形线",
    category: "旋轮线、摆线与内/外旋轮族",
    latex: String.raw`x=a\cos^3t,\quad y=a\sin^3t`,
    introduction: "星形线由圆在更大圆内滚动形成，四个尖角和四重对称构成鲜明的几何轮廓。",
    parameterDefaults: {a: 9},
    parameterRanges: {a: {min: 5, max: 10}},
    plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10},
    points: ({a}) => parametric(1800, (t) => ({x: a * Math.cos(t) ** 3, y: a * Math.sin(t) ** 3})),
    dynamicLatex: ({a}, progress) => String.raw`x=${a.toFixed(1)}\cos^3t,\quad y=${a.toFixed(1)}\sin^3t,\quad t=${(progress * Math.PI * 2).toFixed(2)}`,
  },
  {
    id: "nephroid",
    name: "肾形线",
    category: "旋轮线、摆线与内/外旋轮族",
    latex: String.raw`x=a(3\cos t-\cos3t),\quad y=a(3\sin t-\sin3t)`,
    introduction: "肾形线是外摆线的一种，两个尖角和圆润的内凹共同形成类似肾脏的对称造型。",
    parameterDefaults: {a: 1.5},
    parameterRanges: {a: {min: 0.8, max: 2.5}},
    plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10},
    points: ({a}) => parametric(2200, (t) => ({x: a * (3 * Math.cos(t) - Math.cos(3 * t)), y: a * (3 * Math.sin(t) - Math.sin(3 * t))})),
    dynamicLatex: ({a}, progress) => String.raw`x=${a.toFixed(2)}(3\cos t-\cos3t),\quad y=${a.toFixed(2)}(3\sin t-\sin3t),\quad t=${(progress * Math.PI * 2).toFixed(2)}`,
  },
  {
    id: "deltoid",
    name: "戴尔特线",
    category: "旋轮线、摆线与内/外旋轮族",
    latex: String.raw`x=2a\cos t+a\cos2t,\quad y=2a\sin t-a\sin2t`,
    introduction: "戴尔特线是三尖角内摆线，三个圆润的尖角围绕中心均匀分布。",
    parameterDefaults: {a: 2.2},
    parameterRanges: {a: {min: 1.2, max: 3}},
    plot: {xMin: -8, xMax: 8, yMin: -8, yMax: 8},
    points: ({a}) => parametric(1800, (t) => ({x: 2 * a * Math.cos(t) + a * Math.cos(2 * t), y: 2 * a * Math.sin(t) - a * Math.sin(2 * t)})),
    dynamicLatex: ({a}, progress) => String.raw`x=2(${a.toFixed(2)})\cos t+${a.toFixed(2)}\cos2t,\quad y=2(${a.toFixed(2)})\sin t-${a.toFixed(2)}\sin2t` + String.raw`,\quad t=${(progress * Math.PI * 2).toFixed(2)}`,
  },
  {
    id: "epitrochoid",
    name: "外旋轮线",
    category: "旋轮线、摆线与内/外旋轮族",
    latex: String.raw`x=(R+r)\cos t-d\cos\frac{R+r}{r}t,\quad y=(R+r)\sin t-d\sin\frac{R+r}{r}t`,
    introduction: "外旋轮线模拟万花尺外圈画法，通过大小圆半径比和笔尖距离生成万花筒式轨迹。",
    parameterDefaults: {R: 5, r: 2, d: 3.2},
    parameterRanges: {R: {min: 3, max: 8}, r: {min: 1, max: 4}, d: {min: 1, max: 6}},
    plot: {xMin: -12, xMax: 12, yMin: -12, yMax: 12},
    points: ({R, r, d}) => sample(3600, (progress) => { const ratio = (R + r) / r; const t = progress * Math.PI * 2 * denominatorForRatio(ratio); return {x: (R + r) * Math.cos(t) - d * Math.cos(ratio * t), y: (R + r) * Math.sin(t) - d * Math.sin(ratio * t)}; }),
    dynamicLatex: ({R, r, d}, progress) => String.raw`x=(${R.toFixed(1)}+${r.toFixed(1)})\cos t-${d.toFixed(1)}\cos\frac{${R.toFixed(1)}+${r.toFixed(1)}}{${r.toFixed(1)}}t,\quad t=${(progress * Math.PI * 2 * r).toFixed(2)}`,
  },
  {
    id: "hypotrochoid",
    name: "内旋轮线",
    category: "旋轮线、摆线与内/外旋轮族",
    latex: String.raw`x=(R-r)\cos t+d\cos\frac{R-r}{r}t,\quad y=(R-r)\sin t-d\sin\frac{R-r}{r}t`,
    introduction: "内旋轮线模拟万花尺内圈画法，圆内滚动产生高度规则的几何花纹。",
    parameterDefaults: {R: 7, r: 2, d: 3.5},
    parameterRanges: {R: {min: 4, max: 9}, r: {min: 1, max: 3}, d: {min: 1, max: 7}},
    plot: {xMin: -12, xMax: 12, yMin: -12, yMax: 12},
    points: ({R, r, d}) => sample(3600, (progress) => { const ratio = (R - r) / r; const t = progress * Math.PI * 2 * denominatorForRatio(ratio); return {x: (R - r) * Math.cos(t) + d * Math.cos(ratio * t), y: (R - r) * Math.sin(t) - d * Math.sin(ratio * t)}; }),
    dynamicLatex: ({R, r, d}, progress) => String.raw`x=(${R.toFixed(1)}-${r.toFixed(1)})\cos t+${d.toFixed(1)}\cos\frac{${R.toFixed(1)}-${r.toFixed(1)}}{${r.toFixed(1)}}t,\quad t=${(progress * Math.PI * 2 * r).toFixed(2)}`,
  },
  {
    id: "cycloid",
    name: "平摆线",
    category: "旋轮线、摆线与内/外旋轮族",
    latex: String.raw`x=r(t-\sin t),\quad y=r(1-\cos t)`,
    introduction: "平摆线记录圆沿直线纯滚动时圆周上一点的运动轨迹，连续的拱形与尖点具有清晰的运动感。",
    parameterDefaults: {r: 2.2, turns: 2},
    parameterRanges: {r: {min: 1, max: 3}, turns: {min: 1, max: 4}},
    plot: {xMin: 0, xMax: 30, yMin: 0, yMax: 7},
    points: ({r, turns}) => sample(2600, (progress) => { const t = progress * Math.PI * 2 * turns; return {x: r * (t - Math.sin(t)), y: r * (1 - Math.cos(t))}; }),
    dynamicLatex: ({r}, progress) => String.raw`x=${r.toFixed(2)}(t-\sin t),\quad y=${r.toFixed(2)}(1-\cos t),\quad t=${(progress * Math.PI * 4).toFixed(2)}`,
  },
  {
    id: "involute",
    name: "圆的渐开线",
    category: "旋轮线、摆线与内/外旋轮族",
    latex: String.raw`x=r(\cos t+t\sin t),\quad y=r(\sin t-t\cos t)`,
    introduction: "圆的渐开线描述一条绷紧的线从圆周展开时端点的运动，是齿轮齿形背后的经典几何轨迹。",
    parameterDefaults: {r: 2, turns: 2.5},
    parameterRanges: {r: {min: 1, max: 3}, turns: {min: 1, max: 4}},
    plot: {xMin: -20, xMax: 20, yMin: -20, yMax: 20},
    points: ({r, turns}) => sample(2400, (progress) => { const t = progress * Math.PI * 2 * turns; return {x: r * (Math.cos(t) + t * Math.sin(t)), y: r * (Math.sin(t) - t * Math.cos(t))}; }),
    dynamicLatex: ({r}, progress) => String.raw`x=${r.toFixed(2)}(\cos t+t\sin t),\quad y=${r.toFixed(2)}(\sin t-t\cos t),\quad t=${(progress * Math.PI * 5).toFixed(2)}`,
  },
  {
    id: "tractrix",
    name: "曳物线",
    category: "旋轮线、摆线与内/外旋轮族",
    latex: String.raw`x=a(\ln\tan\frac{t}{2}+\cos t),\quad y=a\sin t`,
    introduction: "曳物线描绘被拖动物体的切线轨迹，端点附近的趋近行为使它兼具优雅和动力学意味。",
    parameterDefaults: {a: 4, margin: 0.035},
    parameterRanges: {a: {min: 2, max: 6}, margin: {min: 0.02, max: 0.08}},
    plot: {xMin: -18, xMax: 2, yMin: 0, yMax: 6},
    points: ({a, margin}) => sample(2200, (progress) => { const t = margin + progress * (Math.PI - 2 * margin); return {x: a * (Math.log(Math.tan(t / 2)) + Math.cos(t)), y: a * Math.sin(t)}; }),
    dynamicLatex: ({a, margin}, progress) => String.raw`x=${a.toFixed(1)}(\ln\tan\frac{t}{2}+\cos t),\quad y=${a.toFixed(1)}\sin t,\quad t=${(margin + progress * (Math.PI - 2 * margin)).toFixed(2)}`,
  },
  {
    id: "pentaspoid",
    name: "五角内摆线",
    category: "旋轮线、摆线与内/外旋轮族",
    latex: String.raw`x=4a\cos t+a\cos4t,\quad y=4a\sin t-a\sin4t`,
    introduction: "五角内摆线由四倍角项调制基础圆周，形成五个均匀分布的尖角。",
    parameterDefaults: {a: 1.8},
    parameterRanges: {a: {min: 1, max: 2.8}},
    plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10},
    points: ({a}) => parametric(2400, (t) => ({x: 4 * a * Math.cos(t) + a * Math.cos(4 * t), y: 4 * a * Math.sin(t) - a * Math.sin(4 * t)})),
    dynamicLatex: ({a}, progress) => String.raw`x=4(${a.toFixed(2)})\cos t+${a.toFixed(2)}\cos4t,\quad y=4(${a.toFixed(2)})\sin t-${a.toFixed(2)}\sin4t,\quad t=${(progress * Math.PI * 2).toFixed(2)}`,
  },
  {
    id: "gear",
    name: "齿轮曲线",
    category: "旋轮线、摆线与内/外旋轮族",
    latex: String.raw`r=a+\frac{1}{b}\tanh(b\sin(c\theta))`,
    introduction: "齿轮曲线用双曲正切函数把周期性齿形平滑化，得到兼具机械感和连续性的轮廓。",
    parameterDefaults: {a: 6, b: 3, teeth: 12},
    parameterRanges: {a: {min: 4, max: 8}, b: {min: 1, max: 6}, teeth: {min: 4, max: 24}},
    plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10},
    points: ({a, b, teeth}) => parametric(2800, (theta) => polar(theta, a + Math.tanh(b * Math.sin(teeth * theta)) / b)),
    dynamicLatex: ({a, b, teeth}, progress) => String.raw`r=${a.toFixed(1)}+\frac{1}{${b.toFixed(1)}}\tanh(${b.toFixed(1)}\sin(${teeth.toFixed(0)}\theta)),\quad \theta=${(progress * Math.PI * 2).toFixed(2)}`,
  },
];

type ExtraDefinition = Omit<FormulaDefinition, "introduction" | "dynamicLatex"> & {introduction?: string; dynamicLatex?: FormulaDefinition["dynamicLatex"]};
const extra = (item: ExtraDefinition): FormulaDefinition => ({
  ...item,
  introduction: item.introduction ?? `${item.name}是一条具有鲜明几何轮廓的数学曲线，通过连续变化呈现独特的对称、起伏或延展形态。`,
  dynamicLatex: item.dynamicLatex ?? (() => item.latex),
});

/**
 * 生成面向观众的公式介绍。
 * 目录中的 introduction 负责说明公式特色，补充句只描述观众能看到的视觉变化，
 * 不暴露参数范围、采样算法等内部实现细节。
 */
export const createMathSummary = (definition: FormulaDefinition) => {
  return `${definition.introduction} 观看这段动画，你会看到曲线从起点逐步展开，直观感受抽象公式如何变成连续而富有节奏的几何图形。`;
};

const graph = (count: number, xMin: number, xMax: number, fn: (x: number) => number) => sample(count, (progress) => { const x = xMin + (xMax - xMin) * progress; return {x, y: fn(x)}; });
const polarRange = (count: number, thetaMin: number, thetaMax: number, fn: (theta: number) => number) => sample(count, (progress) => { const theta = thetaMin + (thetaMax - thetaMin) * progress; return polar(theta, fn(theta)); });
const integrate = (count: number, tMax: number, fx: (t: number) => number, fy: (t: number) => number) => {
  let x = 0, y = 0;
  return sample(count, (progress) => { const t = progress * tMax; const step = tMax / count; if (progress > 0) { x += fx(t) * step; y += fy(t) * step; } return {x, y}; });
};
const besselJ0 = (x: number) => { let sum = 1, term = 1; for (let k = 1; k <= 12; k += 1) { term *= -(x * x) / (4 * k * k); sum += term; } return sum; };
const extendedDefinitions: FormulaDefinition[] = [
  extra({id: "harmonograph", name: "谐振曲线", category: "利萨茹与谐振叠加族", latex: String.raw`x=A_1\sin(f_1t+d_1)e^{-k_1t}+A_2\sin(f_2t+d_2)e^{-k_2t},\quad y=B_1\sin(f_3t+d_3)e^{-k_3t}+B_2\sin(f_4t+d_4)e^{-k_4t}`, parameterDefaults: {a1: 1, a2: 0.7, b1: 1, b2: 0.8, decay: 0.035}, parameterRanges: {a1: {min: 0.5, max: 2}, a2: {min: 0.2, max: 1.5}, b1: {min: 0.4, max: 2}, b2: {min: 0.4, max: 2}, decay: {min: 0.005, max: 0.12}}, plot: {xMin: -3, xMax: 3, yMin: -3, yMax: 3}, points: ({a1, a2, b1, b2, decay}) => sample(2600, (p) => { const t = p * Math.PI * 12; return {x: a1 * Math.sin(b1 * t) * Math.exp(-decay * t) + a2 * Math.sin((b1 + 0.23) * t) * Math.exp(-decay * 1.3 * t), y: b1 * Math.cos(b2 * t) * Math.exp(-decay * t) + b2 * Math.cos((b2 + 0.17) * t) * Math.exp(-decay * 1.1 * t)}; })}),
  extra({id: "amplitude-modulated", name: "调幅正弦曲线", category: "利萨茹与谐振叠加族", latex: String.raw`y=\sin x\cdot\sin(10x)`, parameterDefaults: {carrier: 10}, parameterRanges: {carrier: {min: 4, max: 18}}, plot: {xMin: -Math.PI * 4, xMax: Math.PI * 4, yMin: -1.2, yMax: 1.2}, points: ({carrier}) => graph(1800, -Math.PI * 4, Math.PI * 4, (x) => Math.sin(x) * Math.sin(carrier * x))}),
  extra({id: "frequency-modulated", name: "调频波形曲线", category: "利萨茹与谐振叠加族", latex: String.raw`y=\sin(x+\sin(5x))`, parameterDefaults: {modulation: 5}, parameterRanges: {modulation: {min: 2, max: 10}}, plot: {xMin: -Math.PI * 4, xMax: Math.PI * 4, yMin: -1.2, yMax: 1.2}, points: ({modulation}) => graph(1800, -Math.PI * 4, Math.PI * 4, (x) => Math.sin(x + Math.sin(modulation * x)))}),
  extra({id: "beat-wave", name: "拍频波形线", category: "利萨茹与谐振叠加族", latex: String.raw`y=\cos(10x)+\cos(11x)`, parameterDefaults: {f1: 10, f2: 11}, parameterRanges: {f1: {min: 5, max: 15}, f2: {min: 6, max: 16}}, plot: {xMin: -Math.PI * 4, xMax: Math.PI * 4, yMin: -2.2, yMax: 2.2}, points: ({f1, f2}) => graph(1800, -Math.PI * 4, Math.PI * 4, (x) => Math.cos(f1 * x) + Math.cos(f2 * x))}),
  extra({id: "parametric-heart", name: "参数高维爱心线", category: "浪漫爱心与情感造型族", latex: String.raw`x=16\sin^3t,\quad y=13\cos t-5\cos2t-2\cos3t-\cos4t`, parameterDefaults: {scale: 0.55}, parameterRanges: {scale: {min: 0.35, max: 0.8}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({scale}) => parametric(2200, (t) => ({x: scale * 16 * Math.sin(t) ** 3, y: scale * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))}))}),
  extra({id: "algebraic-heart", name: "代数心形线", category: "浪漫爱心与情感造型族", latex: String.raw`(x^2+y^2-1)^3-x^2y^3=0`, parameterDefaults: {scale: 6}, parameterRanges: {scale: {min: 4, max: 8}}, plot: {xMin: -8, xMax: 8, yMin: -8, yMax: 8}, points: ({scale}) => parametric(2200, (t) => ({x: scale * Math.sin(t) ** 3, y: scale * (0.8 * Math.cos(t) - 0.3 * Math.cos(2 * t) - 0.1 * Math.cos(3 * t))}))}),
  extra({id: "parabolic-heart", name: "抛物线拼接心形", category: "浪漫爱心与情感造型族", latex: String.raw`x^2+(y-\sqrt{|x|})^2=1`, parameterDefaults: {scale: 5}, parameterRanges: {scale: {min: 3, max: 7}}, plot: {xMin: -8, xMax: 8, yMin: -3, yMax: 8}, points: ({scale}) => parametric(2200, (t) => { const x = scale * Math.cos(t); return {x, y: scale * (Math.abs(Math.sin(t)) + 0.35 * Math.cos(t))}; })}),
  extra({id: "teardrop-heart", name: "水滴心形线", category: "浪漫爱心与情感造型族", latex: String.raw`r=1-\sin\theta`, parameterDefaults: {scale: 7}, parameterRanges: {scale: {min: 4, max: 9}}, plot: {xMin: -8, xMax: 8, yMin: -8, yMax: 8}, points: ({scale}) => polarRange(1800, 0, Math.PI * 2, (theta) => scale * (1 - Math.sin(theta)))}),
  extra({id: "archimedean-spiral", name: "阿基米德螺线", category: "螺线与双曲极坐标族", latex: String.raw`r=a\theta`, parameterDefaults: {a: 0.45, turns: 3}, parameterRanges: {a: {min: 0.2, max: 0.8}, turns: {min: 2, max: 5}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a, turns}) => polarRange(2400, 0, Math.PI * 2 * turns, (theta) => a * theta)}),
  extra({id: "logarithmic-spiral", name: "对数螺线", category: "螺线与双曲极坐标族", latex: String.raw`r=ae^{b\theta}`, parameterDefaults: {a: 0.7, b: 0.12}, parameterRanges: {a: {min: 0.3, max: 1.2}, b: {min: 0.04, max: 0.25}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a, b}) => polarRange(2400, -Math.PI * 4, Math.PI * 4, (theta) => a * Math.exp(b * theta))}),
  extra({id: "euler-spiral", name: "欧拉螺线", category: "螺线与双曲极坐标族", latex: String.raw`x=\int_0^t\cos(u^2)du,\quad y=\int_0^t\sin(u^2)du`, parameterDefaults: {span: 5}, parameterRanges: {span: {min: 3, max: 7}}, plot: {xMin: -2, xMax: 2, yMin: -2, yMax: 2}, points: ({span}) => integrate(1800, span, (t) => Math.cos(t * t), (t) => Math.sin(t * t))}),
  extra({id: "fermat-spiral", name: "费马螺线", category: "螺线与双曲极坐标族", latex: String.raw`r^2=a^2\theta`, parameterDefaults: {a: 1.2, turns: 3}, parameterRanges: {a: {min: 0.7, max: 1.8}, turns: {min: 2, max: 5}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a, turns}) => polarRange(2400, 0, Math.PI * 2 * turns, (theta) => a * Math.sqrt(Math.max(theta, 0)))}),
  extra({id: "lituus", name: "连锁螺线", category: "螺线与双曲极坐标族", latex: String.raw`r^2\theta=a^2`, parameterDefaults: {a: 5}, parameterRanges: {a: {min: 3, max: 7}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a}) => polarRange(2400, 0.15, Math.PI * 8, (theta) => a / Math.sqrt(theta))}),
  extra({id: "hyperbolic-spiral", name: "双曲螺线", category: "螺线与双曲极坐标族", latex: String.raw`r\theta=a`, parameterDefaults: {a: 5}, parameterRanges: {a: {min: 2, max: 8}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a}) => polarRange(2400, 0.25, Math.PI * 8, (theta) => a / theta)}),
  extra({id: "poinsot-spiral", name: "波普螺线", category: "螺线与双曲极坐标族", latex: String.raw`r=a\,\mathrm{sech}(b\theta)`, parameterDefaults: {a: 7, b: 0.2}, parameterRanges: {a: {min: 4, max: 9}, b: {min: 0.08, max: 0.5}}, plot: {xMin: -9, xMax: 9, yMin: -9, yMax: 9}, points: ({a, b}) => polarRange(2200, -Math.PI * 5, Math.PI * 5, (theta) => a / Math.cosh(b * theta))}),
  extra({id: "sinusoidal-spiral", name: "正弦波螺线", category: "螺线与双曲极坐标族", latex: String.raw`r^n=a^n\cos(n\theta)`, parameterDefaults: {a: 7, n: 2}, parameterRanges: {a: {min: 4, max: 9}, n: {min: 1, max: 4}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a, n}) => polarRange(2200, 0, Math.PI * 2, (theta) => a * Math.sign(Math.cos(n * theta)) * Math.pow(Math.abs(Math.cos(n * theta)), 1 / n))}),
  extra({id: "cotes-spiral", name: "科茨螺线", category: "螺线与双曲极坐标族", latex: String.raw`r=\frac{a}{\cosh(k\theta)}`, parameterDefaults: {a: 8, k: 0.2}, parameterRanges: {a: {min: 4, max: 10}, k: {min: 0.08, max: 0.5}}, plot: {xMin: -9, xMax: 9, yMin: -9, yMax: 9}, points: ({a, k}) => polarRange(2200, -Math.PI * 5, Math.PI * 5, (theta) => a / Math.cosh(k * theta))}),
  extra({id: "golden-spiral", name: "黄金螺线", category: "螺线与双曲极坐标族", latex: String.raw`r=a\varphi^{2\theta/\pi}`, parameterDefaults: {a: 0.7}, parameterRanges: {a: {min: 0.3, max: 1.2}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a}) => polarRange(2400, -Math.PI * 3, Math.PI * 3, (theta) => a * Math.pow((1 + Math.sqrt(5)) / 2, 2 * theta / Math.PI))}),
  extra({id: "superellipse", name: "拉梅超椭圆", category: "超级曲线与吉利斯公式族", latex: String.raw`|x/a|^n+|y/b|^n=1`, parameterDefaults: {a: 8, b: 6, n: 3}, parameterRanges: {a: {min: 5, max: 10}, b: {min: 4, max: 8}, n: {min: 1.5, max: 6}}, plot: {xMin: -10, xMax: 10, yMin: -8, yMax: 8}, points: ({a, b, n}) => parametric(2200, (t) => ({x: a * Math.sign(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), 2 / n), y: b * Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), 2 / n)}))}),
  extra({id: "gielis-superformula", name: "吉利斯超级公式曲线", category: "超级曲线与吉利斯公式族", latex: String.raw`r=(|\frac{\cos(m\theta/4)}a|^{n_2}+|\frac{\sin(m\theta/4)}b|^{n_3})^{-1/n_1}`, parameterDefaults: {a: 1, b: 1, m: 7, n1: 0.3, n2: 1.7, n3: 1.7}, parameterRanges: {a: {min: 0.7, max: 1.4}, b: {min: 0.7, max: 1.4}, m: {min: 3, max: 12}, n1: {min: 0.15, max: 1}, n2: {min: 0.5, max: 3}, n3: {min: 0.5, max: 3}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a, b, m, n1, n2, n3}) => polarRange(2600, 0, Math.PI * 2, (theta) => Math.pow(Math.pow(Math.abs(Math.cos(m * theta / 4) / a), n2) + Math.pow(Math.abs(Math.sin(m * theta / 4) / b), n3), -1 / n1))}),
  extra({id: "superastroid", name: "星形超二次线", category: "超级曲线与吉利斯公式族", latex: String.raw`|x/a|^{2/3}+|y/b|^{2/3}=1`, parameterDefaults: {a: 8, b: 8}, parameterRanges: {a: {min: 5, max: 10}, b: {min: 5, max: 10}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a, b}) => parametric(2000, (t) => ({x: a * Math.sign(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), 3), y: b * Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), 3)}))}),
  extra({id: "concave-square", name: "凹面正方形", category: "超级曲线与吉利斯公式族", latex: String.raw`x^{0.5}+y^{0.5}=a^{0.5}`, parameterDefaults: {a: 8, concavity: 0.55}, parameterRanges: {a: {min: 5, max: 10}, concavity: {min: 0.3, max: 0.8}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a, concavity}) => parametric(2200, (t) => ({x: a * Math.sign(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), 0.75 + concavity / 2), y: a * Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), 0.75 + concavity / 2)}))}),
  extra({id: "squircle", name: "方圆形", category: "超级曲线与吉利斯公式族", latex: String.raw`x^4+y^4=r^4`, parameterDefaults: {r: 8}, parameterRanges: {r: {min: 5, max: 10}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({r}) => parametric(2000, (t) => ({x: r * Math.sign(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), 0.5), y: r * Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), 0.5)}))}),
  extra({id: "ellipse", name: "椭圆", category: "经典代数与解析几何美学线", latex: String.raw`\frac{x^2}{a^2}+\frac{y^2}{b^2}=1`, parameterDefaults: {a: 8, b: 5}, parameterRanges: {a: {min: 4, max: 10}, b: {min: 3, max: 8}}, plot: {xMin: -10, xMax: 10, yMin: -8, yMax: 8}, points: ({a, b}) => parametric(1800, (t) => ({x: a * Math.cos(t), y: b * Math.sin(t)}))}),
  extra({id: "equilateral-hyperbola", name: "等轴双曲线", category: "经典代数与解析几何美学线", latex: String.raw`x^2-y^2=a^2`, parameterDefaults: {a: 2}, parameterRanges: {a: {min: 1, max: 4}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a}) => sample(1800, (p) => { const t = -1.2 + p * 2.4; return {x: a / Math.cos(t), y: a * Math.tan(t)}; })}),
  extra({id: "catenary", name: "悬链线", category: "经典代数与解析几何美学线", latex: String.raw`y=a\cosh(x/a)`, parameterDefaults: {a: 3}, parameterRanges: {a: {min: 1.5, max: 5}}, plot: {xMin: -10, xMax: 10, yMin: 0, yMax: 10}, points: ({a}) => graph(1600, -a * 2.3, a * 2.3, (x) => a * Math.cosh(x / a))}),
  extra({id: "witch-of-agnesi", name: "阿涅西魔女线", category: "经典代数与解析几何美学线", latex: String.raw`y=\frac{8a^3}{x^2+4a^2}`, parameterDefaults: {a: 3}, parameterRanges: {a: {min: 1.5, max: 5}}, plot: {xMin: -12, xMax: 12, yMin: 0, yMax: 8}, points: ({a}) => graph(1600, -a * 4, a * 4, (x) => 8 * a ** 3 / (x * x + 4 * a * a))}),
  extra({id: "trisectrix", name: "麦克劳林三分角线", category: "经典代数与解析几何美学线", latex: String.raw`r=a\frac{\sin3\theta}{\sin\theta}`, parameterDefaults: {a: 5}, parameterRanges: {a: {min: 3, max: 7}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a}) => polarRange(2200, -Math.PI * 0.92, Math.PI * 0.92, (theta) => a * Math.sin(3 * theta) / (Math.abs(Math.sin(theta)) < 0.05 ? 0.05 : Math.sin(theta)))}),
  extra({id: "cissoid", name: "狄奥克勒斯蔓叶线", category: "经典代数与解析几何美学线", latex: String.raw`y^2(2a-x)=x^3`, parameterDefaults: {a: 4}, parameterRanges: {a: {min: 2, max: 6}}, plot: {xMin: -3, xMax: 8, yMin: -8, yMax: 8}, points: ({a}) => sample(2200, (p) => { const t = -1.35 + p * 2.7; return {x: 2 * a * Math.sin(t) ** 2, y: 2 * a * Math.sin(t) ** 3 / Math.max(0.08, Math.cos(t))}; })}),
  extra({id: "conchoid", name: "尼科梅德斯蚌线", category: "经典代数与解析几何美学线", latex: String.raw`r=a\sec\theta+b`, parameterDefaults: {a: 3, b: 2}, parameterRanges: {a: {min: 1, max: 5}, b: {min: 1, max: 4}}, plot: {xMin: -12, xMax: 12, yMin: -12, yMax: 12}, points: ({a, b}) => polarRange(2200, -1.25, 1.25, (theta) => a / Math.cos(theta) + b)}),
  extra({id: "cayley-sextic", name: "凯莱六次线", category: "经典代数与解析几何美学线", latex: String.raw`r=4a\cos^3(\theta/3)`, parameterDefaults: {a: 2}, parameterRanges: {a: {min: 1, max: 3}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a}) => polarRange(2200, 0, Math.PI * 6, (theta) => 4 * a * Math.cos(theta / 3) ** 3)}),
  extra({id: "gerono-lemniscate", name: "杰罗诺双连线", category: "经典代数与解析几何美学线", latex: String.raw`x=a\sin t,\quad y=a\sin t\cos t`, parameterDefaults: {a: 8}, parameterRanges: {a: {min: 4, max: 10}}, plot: {xMin: -10, xMax: 10, yMin: -6, yMax: 6}, points: ({a}) => parametric(1800, (t) => ({x: a * Math.sin(t), y: a * Math.sin(t) * Math.cos(t)}))}),
  extra({id: "cassini-oval", name: "卡西尼卵形线", category: "经典代数与解析几何美学线", latex: String.raw`(x^2+y^2+c^2)^2-4c^2x^2=b^4`, parameterDefaults: {b: 5, c: 5}, parameterRanges: {b: {min: 3, max: 7}, c: {min: 3, max: 7}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({b, c}) => polarRange(2200, 0, Math.PI * 2, (theta) => { const v = c * c * Math.cos(2 * theta); return Math.sqrt(Math.max(0, v + Math.sqrt(Math.max(0, b ** 4 - c ** 4 * Math.sin(2 * theta) ** 2)))); })}),
  extra({id: "cruciform", name: "十字架线", category: "经典代数与解析几何美学线", latex: String.raw`x^2y^2-a^2x^2-b^2y^2=0`, parameterDefaults: {a: 2, b: 2}, parameterRanges: {a: {min: 1, max: 3}, b: {min: 1, max: 3}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a, b}) => polarRange(2200, 0, Math.PI * 2, (t) => Math.sqrt(Math.max(0.1, (a * b) ** 2 / Math.max(0.1, (a * Math.sin(t)) ** 2 + (b * Math.cos(t)) ** 2))))}),
  extra({id: "devils-curve", name: "魔鬼线", category: "经典代数与解析几何美学线", latex: String.raw`y^2(y^2-b^2)=x^2(x^2-a^2)`, parameterDefaults: {a: 5, b: 4}, parameterRanges: {a: {min: 3, max: 7}, b: {min: 2, max: 6}}, plot: {xMin: -10, xMax: 10, yMin: -8, yMax: 8}, points: ({a, b}) => parametric(2200, (t) => ({x: a * Math.sin(t) * (1 + 0.35 * Math.cos(2 * t)), y: b * Math.cos(t) * (1 + 0.35 * Math.cos(2 * t))}))}),
  extra({id: "kampyle", name: "欧多克索斯坎皮尔线", category: "经典代数与解析几何美学线", latex: String.raw`x^4=a^2(x^2+y^2)`, parameterDefaults: {a: 3}, parameterRanges: {a: {min: 2, max: 5}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a}) => graph(1800, -a * 2.5, a * 2.5, (x) => Math.sqrt(Math.max(0, x ** 4 / (a * a) - x * x)))}),
  extra({id: "tschirnhausen-cubic", name: "齐恩豪斯立方线", category: "经典代数与解析几何美学线", latex: String.raw`3ay^2=x(x-a)^2`, parameterDefaults: {a: 4}, parameterRanges: {a: {min: 2, max: 6}}, plot: {xMin: -3, xMax: 10, yMin: -8, yMax: 8}, points: ({a}) => sample(2200, (p) => { const x = -a * 0.5 + p * a * 2.5; return {x, y: Math.sqrt(Math.max(0, x * (x - a) ** 2 / (3 * a)))}; })}),
  extra({id: "bean", name: "豆形曲线", category: "经典代数与解析几何美学线", latex: String.raw`x^4+x^2y^2+y^4=a(x^3+xy^2)`, parameterDefaults: {a: 7}, parameterRanges: {a: {min: 4, max: 9}}, plot: {xMin: -10, xMax: 10, yMin: -8, yMax: 8}, points: ({a}) => polarRange(2200, 0, Math.PI * 2, (t) => a * (0.55 + 0.25 * Math.cos(t) - 0.08 * Math.cos(2 * t)))}),
  extra({id: "dumbbell", name: "哑铃形曲线", category: "经典代数与解析几何美学线", latex: String.raw`a^4y^2=x^4(a^2-x^2)`, parameterDefaults: {a: 7}, parameterRanges: {a: {min: 4, max: 9}}, plot: {xMin: -8, xMax: 8, yMin: -8, yMax: 8}, points: ({a}) => sample(2000, (p) => { const x = -a + 2 * a * p; return {x, y: Math.abs(x * x * Math.sqrt(Math.max(0, a * a - x * x)) / (a * a))}; })}),
  extra({id: "bullet-nose", name: "子弹头线", category: "经典代数与解析几何美学线", latex: String.raw`a^2y^2-b^2x^2=x^2y^2`, parameterDefaults: {a: 5, b: 3}, parameterRanges: {a: {min: 3, max: 7}, b: {min: 2, max: 5}}, plot: {xMin: -10, xMax: 10, yMin: -8, yMax: 8}, points: ({a, b}) => graph(2000, -a * 1.5, a * 1.5, (x) => Math.abs(b * x / Math.sqrt(Math.max(0.1, a * a - x * x))))}),
  extra({id: "teardrop", name: "水滴形线", category: "经典代数与解析几何美学线", latex: String.raw`x=a(1-\sin t)\cos t,\quad y=a(1-\sin t)\sin t`, parameterDefaults: {a: 7}, parameterRanges: {a: {min: 4, max: 9}}, plot: {xMin: -8, xMax: 8, yMin: -8, yMax: 8}, points: ({a}) => parametric(1800, (t) => ({x: a * (1 - Math.sin(t)) * Math.cos(t), y: a * (1 - Math.sin(t)) * Math.sin(t)}))}),
  extra({id: "fish", name: "鱼形曲线", category: "经典代数与解析几何美学线", latex: String.raw`x=a(\cos t-\frac{\sin^2t}{\sqrt2}),\quad y=a\sin t\cos t`, parameterDefaults: {a: 8}, parameterRanges: {a: {min: 4, max: 10}}, plot: {xMin: -10, xMax: 10, yMin: -6, yMax: 6}, points: ({a}) => parametric(1800, (t) => ({x: a * (Math.cos(t) - Math.sin(t) ** 2 / Math.sqrt(2)), y: a * Math.sin(t) * Math.cos(t)}))}),
  extra({id: "bow", name: "弓形线", category: "经典代数与解析几何美学线", latex: String.raw`x=a(1-t^2),\quad y=at(1-t^2)`, parameterDefaults: {a: 6}, parameterRanges: {a: {min: 3, max: 9}}, plot: {xMin: -8, xMax: 8, yMin: -8, yMax: 8}, points: ({a}) => sample(1800, (p) => { const t = -1.4 + p * 2.8; return {x: a * (1 - t * t), y: a * t * (1 - t * t)}; })}),
  extra({id: "talbot", name: "塔伯特曲线", category: "经典代数与解析几何美学线", latex: String.raw`x=a\cos t,\quad y=b\sin t+c\tan t`, parameterDefaults: {a: 6, b: 4, c: 1}, parameterRanges: {a: {min: 3, max: 8}, b: {min: 2, max: 6}, c: {min: 0.2, max: 2}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a, b, c}) => sample(2000, (p) => { const t = -1.35 + p * 2.7; return {x: a * Math.cos(t), y: b * Math.sin(t) + c * Math.tan(t)}; })}),
  extra({id: "freeth-nephroid", name: "弗里斯肾形线", category: "经典代数与解析几何美学线", latex: String.raw`r=a(1+2\sin\frac{\theta}{2})`, parameterDefaults: {a: 4}, parameterRanges: {a: {min: 2, max: 6}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a}) => polarRange(1800, 0, Math.PI * 2, (t) => a * (1 + 2 * Math.sin(t / 2)))}),
  extra({id: "watt", name: "瓦特曲线", category: "经典代数与解析几何美学线", latex: String.raw`(x^2+y^2)(x^2+y^2-d^2)^2=4a^2y^2(x^2+y^2)`, parameterDefaults: {a: 3, d: 5}, parameterRanges: {a: {min: 2, max: 5}, d: {min: 3, max: 7}}, plot: {xMin: -10, xMax: 10, yMin: -8, yMax: 8}, points: ({a, d}) => parametric(2200, (t) => ({x: d * Math.cos(t) + a * Math.cos(2 * t), y: d * Math.sin(t) + a * Math.sin(2 * t)}))}),
  extra({id: "inner-loop-limacon", name: "双环蜗线", category: "经典代数与解析几何美学线", latex: String.raw`r=1+2\cos\theta`, parameterDefaults: {a: 1, b: 2}, parameterRanges: {a: {min: 0.7, max: 1.4}, b: {min: 1.5, max: 2.5}}, plot: {xMin: -4, xMax: 4, yMin: -4, yMax: 4}, points: ({a, b}) => polarRange(1800, 0, Math.PI * 2, (t) => a + b * Math.cos(t))}),
  extra({id: "convex-limacon", name: "凸形蜗线", category: "经典代数与解析几何美学线", latex: String.raw`r=2+\cos\theta`, parameterDefaults: {a: 2, b: 1}, parameterRanges: {a: {min: 1.5, max: 3}, b: {min: 0.5, max: 1.5}}, plot: {xMin: -5, xMax: 5, yMin: -5, yMax: 5}, points: ({a, b}) => polarRange(1800, 0, Math.PI * 2, (t) => a + b * Math.cos(t))}),
  extra({id: "gaussian", name: "高斯钟形曲线", category: "波形包络与连续函数艺术族", latex: String.raw`y=ae^{-\frac{(x-\mu)^2}{2\sigma^2}}`, parameterDefaults: {a: 6, mu: 0, sigma: 2}, parameterRanges: {a: {min: 3, max: 8}, mu: {min: -2, max: 2}, sigma: {min: 1, max: 4}}, plot: {xMin: -10, xMax: 10, yMin: 0, yMax: 8}, points: ({a, mu, sigma}) => graph(1800, mu - sigma * 4, mu + sigma * 4, (x) => a * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)))}),
  extra({id: "damped-sine", name: "衰减正弦包络", category: "波形包络与连续函数艺术族", latex: String.raw`y=Ae^{-kt}\sin(\omega t)`, parameterDefaults: {A: 1, k: 0.08, omega: 5}, parameterRanges: {A: {min: 0.5, max: 2}, k: {min: 0.02, max: 0.2}, omega: {min: 2, max: 10}}, plot: {xMin: 0, xMax: 25, yMin: -1.5, yMax: 1.5}, points: ({A, k, omega}) => graph(1800, 0, 25, (t) => A * Math.exp(-k * t) * Math.sin(omega * t))}),
  extra({id: "sinc", name: "辛克脉冲曲线", category: "波形包络与连续函数艺术族", latex: String.raw`y=\frac{\sin(\pi x)}{\pi x}`, parameterDefaults: {scale: 1}, parameterRanges: {scale: {min: 0.6, max: 1.5}}, plot: {xMin: -12, xMax: 12, yMin: -0.4, yMax: 1.1}, points: ({scale}) => graph(2000, -12, 12, (x) => { const v = Math.PI * x * scale; return Math.abs(v) < 0.0001 ? 1 : Math.sin(v) / v; })}),
  extra({id: "logistic", name: "逻辑斯蒂 S 型曲线", category: "波形包络与连续函数艺术族", latex: String.raw`y=\frac{L}{1+e^{-k(x-x_0)}}`, parameterDefaults: {L: 7, k: 1, x0: 0}, parameterRanges: {L: {min: 4, max: 9}, k: {min: 0.4, max: 2}, x0: {min: -2, max: 2}}, plot: {xMin: -8, xMax: 8, yMin: 0, yMax: 9}, points: ({L, k, x0}) => graph(1800, -8, 8, (x) => L / (1 + Math.exp(-k * (x - x0))))}),
  extra({id: "fresnel", name: "菲涅耳积分轨迹", category: "波形包络与连续函数艺术族", latex: String.raw`x=\int_0^t\cos\frac{\pi u^2}{2}du,\quad y=\int_0^t\sin\frac{\pi u^2}{2}du`, parameterDefaults: {span: 8}, parameterRanges: {span: {min: 4, max: 12}}, plot: {xMin: -2, xMax: 2, yMin: -2, yMax: 2}, points: ({span}) => integrate(2200, span, (t) => Math.cos(Math.PI * t * t / 2), (t) => Math.sin(Math.PI * t * t / 2))}),
  extra({id: "bessel-j0", name: "零阶贝塞尔函数线", category: "波形包络与连续函数艺术族", latex: String.raw`y=J_0(x)`, parameterDefaults: {scale: 1}, parameterRanges: {scale: {min: 0.6, max: 1.5}}, plot: {xMin: -18, xMax: 18, yMin: -0.5, yMax: 1.1}, points: ({scale}) => graph(2000, -18, 18, (x) => besselJ0(scale * x))}),
  extra({id: "sech-envelope", name: "双曲正割包络线", category: "波形包络与连续函数艺术族", latex: String.raw`y=\mathrm{sech}(x)`, parameterDefaults: {scale: 1}, parameterRanges: {scale: {min: 0.6, max: 1.5}}, plot: {xMin: -8, xMax: 8, yMin: 0, yMax: 1.1}, points: ({scale}) => graph(1600, -8, 8, (x) => 1 / Math.cosh(scale * x))}),
  extra({id: "wave-packet", name: "脉冲波包曲线", category: "波形包络与连续函数艺术族", latex: String.raw`y=e^{-x^2}\cos(8x)`, parameterDefaults: {frequency: 8}, parameterRanges: {frequency: {min: 4, max: 14}}, plot: {xMin: -4, xMax: 4, yMin: -1.1, yMax: 1.1}, points: ({frequency}) => graph(1800, -4, 4, (x) => Math.exp(-x * x) * Math.cos(frequency * x))}),
  extra({id: "tangent-wave", name: "正切渐近波形", category: "波形包络与连续函数艺术族", latex: String.raw`y=\tan(\sin x)`, parameterDefaults: {frequency: 1}, parameterRanges: {frequency: {min: 0.5, max: 2}}, plot: {xMin: -Math.PI * 4, xMax: Math.PI * 4, yMin: -2, yMax: 2}, points: ({frequency}) => graph(2200, -Math.PI * 4, Math.PI * 4, (x) => Math.tan(Math.sin(frequency * x)))}),
  extra({id: "dual-sine", name: "双周期正弦网格线", category: "波形包络与连续函数艺术族", latex: String.raw`y=\sin x+\sin(\sqrt2x)`, parameterDefaults: {ratio: Math.sqrt(2)}, parameterRanges: {ratio: {min: 1.2, max: 1.7}}, plot: {xMin: -Math.PI * 6, xMax: Math.PI * 6, yMin: -2.2, yMax: 2.2}, points: ({ratio}) => graph(2200, -Math.PI * 6, Math.PI * 6, (x) => Math.sin(x) + Math.sin(ratio * x))}),
  extra({id: "reuleaux-triangle", name: "勒洛三角形边界", category: "几何形态与拓扑投影造型族", latex: String.raw`\text{三段等半径圆弧构成的恒宽曲线}`, parameterDefaults: {a: 7}, parameterRanges: {a: {min: 4, max: 9}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a}) => polarRange(1800, 0, Math.PI * 2, (t) => a * (0.78 + 0.22 * Math.cos(3 * t)))}),
  extra({id: "reuleaux-pentagon", name: "勒洛五边形边界", category: "几何形态与拓扑投影造型族", latex: String.raw`\text{五段等半径圆弧构成的恒宽曲线}`, parameterDefaults: {a: 7}, parameterRanges: {a: {min: 4, max: 9}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a}) => polarRange(2000, 0, Math.PI * 2, (t) => a * (0.9 + 0.1 * Math.cos(5 * t)))}),
  extra({id: "kepler-orbit", name: "开普勒椭圆轨道", category: "几何形态与拓扑投影造型族", latex: String.raw`r=\frac{p}{1+e\cos\theta}`, parameterDefaults: {p: 5, eccentricity: 0.45}, parameterRanges: {p: {min: 3, max: 7}, eccentricity: {min: 0, max: 0.85}}, plot: {xMin: -10, xMax: 10, yMin: -8, yMax: 8}, points: ({p, eccentricity}) => polarRange(1800, 0, Math.PI * 2, (t) => p / (1 + eccentricity * Math.cos(t)))}),
  extra({id: "trefoil-projection", name: "三叶结二维投影", category: "几何形态与拓扑投影造型族", latex: String.raw`x=\sin t+2\sin2t,\quad y=\cos t-2\cos2t`, parameterDefaults: {a: 3}, parameterRanges: {a: {min: 2, max: 4}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a}) => parametric(2000, (t) => ({x: a * (Math.sin(t) + 2 * Math.sin(2 * t)), y: a * (Math.cos(t) - 2 * Math.cos(2 * t))}))}),
  extra({id: "figure-eight-projection", name: "八字结二维投影", category: "几何形态与拓扑投影造型族", latex: String.raw`x=(2+\cos2t)\cos3t,\quad y=(2+\cos2t)\sin3t`, parameterDefaults: {a: 2.5}, parameterRanges: {a: {min: 1.5, max: 4}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a}) => parametric(2200, (t) => ({x: a * (2 + Math.cos(2 * t)) * Math.cos(3 * t), y: a * (2 + Math.cos(2 * t)) * Math.sin(3 * t)}))}),
  extra({id: "bicuspid", name: "双角线", category: "几何形态与拓扑投影造型族", latex: String.raw`x=a\cos t,\quad y=\frac{a\sin^2t}{2+\sin t}`, parameterDefaults: {a: 8}, parameterRanges: {a: {min: 4, max: 10}}, plot: {xMin: -10, xMax: 10, yMin: -6, yMax: 6}, points: ({a}) => parametric(1800, (t) => ({x: a * Math.cos(t), y: a * Math.sin(t) ** 2 / (2 + Math.sin(t))}))}),
  extra({id: "spiral-parabola", name: "螺旋抛物线", category: "几何形态与拓扑投影造型族", latex: String.raw`r=a\sqrt\theta`, parameterDefaults: {a: 1.5, turns: 3}, parameterRanges: {a: {min: 0.8, max: 2.2}, turns: {min: 2, max: 5}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a, turns}) => polarRange(2200, 0, Math.PI * 2 * turns, (t) => a * Math.sqrt(t))}),
  extra({id: "crown", name: "皇冠曲线", category: "几何形态与拓扑投影造型族", latex: String.raw`y=\frac{\sin^2x}{1+\cos^2x}`, parameterDefaults: {frequency: 1}, parameterRanges: {frequency: {min: 0.5, max: 2}}, plot: {xMin: -Math.PI * 4, xMax: Math.PI * 4, yMin: 0, yMax: 1.1}, points: ({frequency}) => graph(1800, -Math.PI * 4, Math.PI * 4, (x) => { const s = Math.sin(frequency * x), c = Math.cos(frequency * x); return s * s / (1 + c * c); })}),
  extra({id: "teardrop-cycloid", name: "水滴摆线", category: "几何形态与拓扑投影造型族", latex: String.raw`x=2a\cos t-a\cos2t,\quad y=2a\sin t-a\sin2t`, parameterDefaults: {a: 2}, parameterRanges: {a: {min: 1, max: 3}}, plot: {xMin: -8, xMax: 8, yMin: -8, yMax: 8}, points: ({a}) => parametric(1800, (t) => ({x: 2 * a * Math.cos(t) - a * Math.cos(2 * t), y: 2 * a * Math.sin(t) - a * Math.sin(2 * t)}))}),
  extra({id: "hub", name: "轮毂曲线", category: "几何形态与拓扑投影造型族", latex: String.raw`r=a+b\cos^2(n\theta)`, parameterDefaults: {a: 5, b: 2, n: 8}, parameterRanges: {a: {min: 3, max: 7}, b: {min: 1, max: 3}, n: {min: 4, max: 14}}, plot: {xMin: -9, xMax: 9, yMin: -9, yMax: 9}, points: ({a, b, n}) => polarRange(2200, 0, Math.PI * 2, (t) => a + b * Math.cos(n * t) ** 2)}),
  extra({id: "starburst", name: "星芒线", category: "特殊三角美学与组合曲线族", latex: String.raw`r=1+0.5\sin(n\theta)`, parameterDefaults: {a: 7, n: 12}, parameterRanges: {a: {min: 4, max: 9}, n: {min: 4, max: 24}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a, n}) => polarRange(2200, 0, Math.PI * 2, (t) => a * (1 + 0.5 * Math.sin(n * t)))}),
  extra({id: "gear-astroid", name: "齿轮星线", category: "特殊三角美学与组合曲线族", latex: String.raw`r=a(1+0.1\cos(n\theta))`, parameterDefaults: {a: 7, n: 16}, parameterRanges: {a: {min: 4, max: 9}, n: {min: 4, max: 30}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a, n}) => polarRange(2200, 0, Math.PI * 2, (t) => a * (1 + 0.1 * Math.cos(n * t)))}),
  extra({id: "sinusoidal-ring", name: "正弦环形线", category: "特殊三角美学与组合曲线族", latex: String.raw`r=a+b\sin(k\theta)`, parameterDefaults: {a: 6, b: 1.5, k: 10}, parameterRanges: {a: {min: 4, max: 8}, b: {min: 0.5, max: 2.5}, k: {min: 4, max: 18}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a, b, k}) => polarRange(2200, 0, Math.PI * 2, (t) => a + b * Math.sin(k * t))}),
  extra({id: "sextifolium", name: "六叶玫瑰线", category: "特殊三角美学与组合曲线族", latex: String.raw`r=a\sin(6\theta)`, parameterDefaults: {a: 8}, parameterRanges: {a: {min: 4, max: 10}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({a}) => polarRange(2200, 0, Math.PI * 2, (t) => a * Math.sin(6 * t))}),
  extra({id: "cubic-bezier", name: "三重贝塞尔曲线轨迹", category: "特殊三角美学与组合曲线族", latex: String.raw`P(t)=(1-t)^3P_0+3(1-t)^2tP_1+3(1-t)t^2P_2+t^3P_3`, parameterDefaults: {scale: 1}, parameterRanges: {scale: {min: 0.7, max: 1.5}}, plot: {xMin: -1, xMax: 1, yMin: -1, yMax: 1}, points: ({scale}) => sample(1600, (p) => { const t = p; const u = 1 - t; return {x: scale * (u ** 3 * -0.9 + 3 * u * u * t * -0.4 + 3 * u * t * t * 0.4 + t ** 3 * 0.9), y: scale * (u ** 3 * 0.3 + 3 * u * u * t * 0.9 + 3 * u * t * t * -0.9 + t ** 3 * -0.3)}; })}),
  extra({id: "elliptic-phase", name: "椭圆相空间轨迹", category: "特殊三角美学与组合曲线族", latex: String.raw`\frac{p^2}{2m}+\frac12kq^2=E`, parameterDefaults: {q: 8, p: 5}, parameterRanges: {q: {min: 4, max: 10}, p: {min: 3, max: 7}}, plot: {xMin: -10, xMax: 10, yMin: -8, yMax: 8}, points: ({q, p}) => parametric(1800, (t) => ({x: q * Math.cos(t), y: p * Math.sin(t)}))}),
  extra({id: "spiral-astroid", name: "螺旋星形线", category: "特殊三角美学与组合曲线族", latex: String.raw`x=e^{kt}\cos^3t,\quad y=e^{kt}\sin^3t`, parameterDefaults: {scale: 0.03}, parameterRanges: {scale: {min: 0.01, max: 0.08}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({scale}) => sample(2200, (p) => { const t = -Math.PI * 3 + p * Math.PI * 6; const s = Math.exp(scale * t); return {x: s * Math.cos(t) ** 3, y: s * Math.sin(t) ** 3}; })}),
  extra({id: "dimpled-limacon", name: "帕斯卡蜗线平切变体", category: "特殊三角美学与组合曲线族", latex: String.raw`r=1.5+\cos\theta`, parameterDefaults: {a: 1.5, b: 1}, parameterRanges: {a: {min: 1.2, max: 1.8}, b: {min: 0.7, max: 1.3}}, plot: {xMin: -4, xMax: 4, yMin: -4, yMax: 4}, points: ({a, b}) => polarRange(1800, 0, Math.PI * 2, (t) => a + b * Math.cos(t))}),
  extra({id: "multi-frequency", name: "多频交织波", category: "特殊三角美学与组合曲线族", latex: String.raw`y=\sin x+\frac13\sin3x+\frac15\sin5x`, parameterDefaults: {frequency: 1}, parameterRanges: {frequency: {min: 0.5, max: 2}}, plot: {xMin: -Math.PI * 4, xMax: Math.PI * 4, yMin: -1.8, yMax: 1.8}, points: ({frequency}) => graph(2000, -Math.PI * 4, Math.PI * 4, (x) => Math.sin(frequency * x) + Math.sin(3 * frequency * x) / 3 + Math.sin(5 * frequency * x) / 5)}),
  extra({id: "polar-heart-leaf", name: "极坐标心形叶片线", category: "特殊三角美学与组合曲线族", latex: String.raw`r=\sin\theta\sqrt{|\cos\theta|}`, parameterDefaults: {scale: 9}, parameterRanges: {scale: {min: 5, max: 10}}, plot: {xMin: -10, xMax: 10, yMin: -10, yMax: 10}, points: ({scale}) => polarRange(2000, 0, Math.PI * 2, (t) => scale * Math.sin(t) * Math.sqrt(Math.abs(Math.cos(t))))}),
];

const allDefinitions = [...definitions, ...extendedDefinitions];
export const formulaCatalog = Object.fromEntries(allDefinitions.map((item) => [item.id, item])) as Record<MathFormulaId, FormulaDefinition>;
export const formulaCatalogList = allDefinitions;

export const formulaGroups = [
  {
    label: "极坐标花卉与对称族",
    formulaIds: ["rose", "butterfly", "cardioid", "limacon", "trifolium", "quadrifolium", "lemniscate", "cannabis", "chrysanthemum", "sunflower"] as MathFormulaId[],
  },
  {
    label: "旋轮线、摆线与内/外旋轮族",
    formulaIds: ["astroid", "nephroid", "deltoid", "epitrochoid", "hypotrochoid", "cycloid", "involute", "tractrix", "pentaspoid", "gear"] as MathFormulaId[],
  },
  {
    label: "利萨茹与谐振叠加族",
    formulaIds: ["lissajous", "harmonograph", "amplitude-modulated", "frequency-modulated", "beat-wave"] as MathFormulaId[],
  },
  {
    label: "浪漫爱心与情感造型族",
    formulaIds: ["cardioid", "double-heart", "parametric-heart", "algebraic-heart", "parabolic-heart", "teardrop-heart"] as MathFormulaId[],
  },
  {
    label: "螺线与双曲极坐标族",
    formulaIds: ["archimedean-spiral", "logarithmic-spiral", "euler-spiral", "fermat-spiral", "lituus", "hyperbolic-spiral", "poinsot-spiral", "sinusoidal-spiral", "cotes-spiral", "golden-spiral"] as MathFormulaId[],
  },
  {
    label: "超级曲线与吉利斯公式族",
    formulaIds: ["superellipse", "gielis-superformula", "superastroid", "concave-square", "squircle"] as MathFormulaId[],
  },
  {
    label: "经典代数与解析几何美学线",
    formulaIds: ["ellipse", "equilateral-hyperbola", "catenary", "witch-of-agnesi", "trisectrix", "cissoid", "conchoid", "cayley-sextic", "gerono-lemniscate", "cassini-oval", "cruciform", "devils-curve", "kampyle", "tschirnhausen-cubic", "bean", "dumbbell", "bullet-nose", "teardrop", "fish", "bow", "talbot", "freeth-nephroid", "watt", "inner-loop-limacon", "convex-limacon"] as MathFormulaId[],
  },
  {
    label: "波形包络与连续函数艺术族",
    formulaIds: ["gaussian", "damped-sine", "sinc", "logistic", "fresnel", "bessel-j0", "sech-envelope", "wave-packet", "tangent-wave", "dual-sine"] as MathFormulaId[],
  },
  {
    label: "几何形态与拓扑投影造型族",
    formulaIds: ["reuleaux-triangle", "reuleaux-pentagon", "kepler-orbit", "trefoil-projection", "figure-eight-projection", "bicuspid", "spiral-parabola", "crown", "teardrop-cycloid", "hub"] as MathFormulaId[],
  },
  {
    label: "特殊三角美学与组合曲线族",
    formulaIds: ["starburst", "gear-astroid", "sinusoidal-ring", "sextifolium", "cubic-bezier", "elliptic-phase", "spiral-astroid", "dimpled-limacon", "multi-frequency", "polar-heart-leaf"] as MathFormulaId[],
  },
  {
    label: "现有公式",
    formulaIds: ["polar", "sine"] as MathFormulaId[],
  },
] as const;

export const ensureMathSummaryTags = (summary: string, definition: FormulaDefinition) => {
  const formulaTag = definition.name.replace(/[^\p{L}\p{N}_-]/gu, "");
  const requiredTags = new Set(["#数学之美", `#${formulaTag}`]);
  const seenTags = new Set<string>();
  const base = summary.trim().replace(/#[\p{L}\p{N}_-]+/gu, (tag) => {
    if (requiredTags.has(tag) || seenTags.has(tag)) return "";
    seenTags.add(tag);
    return tag;
  }).replace(/\s{2,}/g, " ").trim();
  return [base, "#数学之美", `#${formulaTag}`].filter(Boolean).join(" ");
};

export const formatFormulaForDisplay = (latex: string, maxLength = 58) => {
  if (latex.length <= maxLength) return latex;
  const middle = latex.length / 2;
  const boundaries = [...latex.matchAll(/,\\quad\s*|,\s*|(?<![A-Za-z])(?:\+|-)\s*/gu)]
    .map((match) => {
      const index = match.index ?? 0;
      return match[0].startsWith(",") ? index + match[0].length : index;
    })
    .filter((index) => index >= 12 && latex.length - index >= 12);
  if (!boundaries.length) return latex;
  const splitAt = boundaries.reduce((best, index) => Math.abs(index - middle) < Math.abs(best - middle) ? index : best, boundaries[0]);
  const firstLine = latex.slice(0, splitAt).trim();
  const secondLine = latex.slice(splitAt).trim();
  return String.raw`\begin{gathered}${firstLine}\\${secondLine}\end{gathered}`;
};

export const clampParameters = (definition: FormulaDefinition, parameters: MathFormulaParameters): MathFormulaParameters =>
  Object.fromEntries(Object.entries(definition.parameterRanges).map(([key, range]) => {
    const value = Number(parameters[key] ?? definition.parameterDefaults[key]);
    return [key, Math.min(range.max, Math.max(range.min, Number.isFinite(value) ? value : definition.parameterDefaults[key]))];
  }));

export type MathVisualDensity = "simple" | "standard" | "dense";

export type FittedFormulaGeometry = {
  points: Point[];
  visualCenter: Point;
  coordinateOrigin: Point;
  contentBounds: {left: number; top: number; right: number; bottom: number; width: number; height: number};
  density: MathVisualDensity;
  complexity: number;
  scale: number;
  padding: {x: number; y: number};
};

export const MATH_DENSITY_PADDING: Record<MathVisualDensity, number> = {
  simple: 0.06,
  standard: 0.09,
  dense: 0.12,
};

const getVisualDensity = (points: Point[], diagonal: number): {density: MathVisualDensity; complexity: number} => {
  const maximumSegment = diagonal * 0.25;
  const pathLength = points.slice(1).reduce((total, point, index) => {
    const previous = points[index];
    return total + Math.min(maximumSegment, Math.hypot(point.x - previous.x, point.y - previous.y));
  }, 0);
  const complexity = pathLength / diagonal;
  return {density: complexity <= 4 ? "simple" : complexity <= 10 ? "standard" : "dense", complexity};
};

export const fitPoints = (
  inputPoints: Point[],
  bounds: {left: number; top: number; width: number; height: number},
): FittedFormulaGeometry => {
  const finitePoints = inputPoints.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const points = finitePoints.length >= 2 ? finitePoints : [{x: 0, y: 0}, {x: 0.0001, y: 0}];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const sourceWidth = Math.max(0.0001, maxX - minX);
  const sourceHeight = Math.max(0.0001, maxY - minY);
  const diagonal = Math.max(0.0001, Math.hypot(sourceWidth, sourceHeight));
  const {density, complexity} = getVisualDensity(points, diagonal);
  const paddingRatio = MATH_DENSITY_PADDING[density];
  const paddingX = Math.min((bounds.width - 1) / 2, Math.max(36, bounds.width * paddingRatio));
  const paddingY = Math.min((bounds.height - 1) / 2, Math.max(36, bounds.height * paddingRatio));
  const availableWidth = Math.max(1, bounds.width - paddingX * 2);
  const availableHeight = Math.max(1, bounds.height - paddingY * 2);
  const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
  const sourceVisualCenter = {x: (minX + maxX) / 2, y: (minY + maxY) / 2};
  const visualCenter = {x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2};
  const fittedPoints = points.map((point) => ({
    x: visualCenter.x + (point.x - sourceVisualCenter.x) * scale,
    y: visualCenter.y - (point.y - sourceVisualCenter.y) * scale,
  }));
  const fittedXs = fittedPoints.map((point) => point.x);
  const fittedYs = fittedPoints.map((point) => point.y);
  const contentLeft = Math.min(...fittedXs), contentRight = Math.max(...fittedXs);
  const contentTop = Math.min(...fittedYs), contentBottom = Math.max(...fittedYs);

  return {
    points: fittedPoints,
    visualCenter,
    coordinateOrigin: {
      x: visualCenter.x - sourceVisualCenter.x * scale,
      y: visualCenter.y + sourceVisualCenter.y * scale,
    },
    contentBounds: {
      left: contentLeft,
      top: contentTop,
      right: contentRight,
      bottom: contentBottom,
      width: contentRight - contentLeft,
      height: contentBottom - contentTop,
    },
    density,
    complexity,
    scale,
    padding: {x: paddingX, y: paddingY},
  };
};

export const pathFromPoints = (points: Point[], progress: number) => {
  const count = Math.max(2, Math.ceil(points.length * Math.min(1, Math.max(0, progress))));
  return points.slice(0, count).map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
};

export const formulaSignature = (id: MathFormulaId, parameters: MathFormulaParameters) => `${id}:${Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${Number(value).toFixed(3)}`).join(",")}`;

export const addSpeedVariation = (progress: number, seed: number) => {
  const value = Math.min(1, Math.max(0, progress));
  const wave = 0.035 * Math.sin(value * Math.PI * 2 * 1.35 + seed) + 0.018 * Math.sin(value * Math.PI * 2 * 2.4 + seed * 1.7);
  return Math.min(1, Math.max(0, value + wave * value * (1 - value)));
};

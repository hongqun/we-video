import {Img, staticFile} from "remotion";
import {useBrand} from "./BrandContext";
import type {RenderManifest} from "./schema";
import {SANS_FONT_FAMILY} from "./typography";
import {VIDEO_COLORS, useVisualTheme} from "./theme";

type Brand = RenderManifest["brand"];
// 品牌名保留账号配置大小写；专题名来自 label，避免各场景自行拼接默认文案。
export const brandSeriesLabel = (brand: Brand) => {
  const parts = brand.label?.split(/\s*[·|｜]\s*/u) ?? [];
  return parts.length > 1 ? parts.slice(1).join(" · ") : brand.label && brand.label.toLowerCase() !== brand.title.toLowerCase() ? brand.label : brand.subtitle;
};

// 封面、所有口播镜头共用同一品牌行；flow 模式只负责参与原场景框架占位。
export const VideoBrand = ({brand: supplied, flow = false}: {brand?: Brand; flow?: boolean}) => {
  const theme = useVisualTheme();
  const inherited = useBrand();
  const brand = supplied ?? inherited;
  if (!brand) return null;
  const src = /^(?:https?:\/\/|data:|\/)/u.test(brand.logoSrc) ? brand.logoSrc : staticFile(brand.logoSrc);
  // Logo 原图已带透明通道；封面只调整前景色，不再额外绘制衬底或外框。
  const logoFilter = theme.scope === "cover" && theme.id === "kinetic-lime" ? "brightness(0) saturate(100%)" : theme.scope === "cover" && theme.id === "deep-signal" ? "drop-shadow(0 0 8px rgba(98,237,53,.34))" : undefined;
  return <div style={{position: flow ? "relative" : "absolute", ...(flow ? {} : {left: 64, top: 60}), display: "flex", alignItems: "center", gap: 14, height: 48, maxWidth: 948, flexShrink: 0, color: VIDEO_COLORS.ink, fontFamily: SANS_FONT_FAMILY}}>
    <span style={{alignItems: "center", display: "inline-flex", height: 48, justifyContent: "center", width: 48}}><Img src={src} style={{width: 44, height: 44, objectFit: "contain", flexShrink: 0, filter: logoFilter}} /></span>
    <span style={{fontSize: 25, fontWeight: 850, letterSpacing: .2}}>{brand.title}</span>
    <span aria-hidden="true" style={{height: 20, width: 1, background: VIDEO_COLORS.line, marginInline: 3, opacity: .52}} />
    <span style={{fontSize: 22, fontWeight: 600, color: VIDEO_COLORS.mutedInk}}>{brandSeriesLabel(brand)}</span>
  </div>;
};

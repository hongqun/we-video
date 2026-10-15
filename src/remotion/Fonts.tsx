import {continueRender, delayRender, staticFile} from "remotion";
import {useEffect, useState} from "react";

/**
 * Loads the video's Chinese fonts (Noto Sans SC + Noto Serif SC, branded here as
 * "Studio Sans" / "Studio Serif") from the vendored woff2 files in public/fonts/
 * via @font-face, and gates rendering until they are embedded.
 *
 * This is what makes Chinese captions/headlines render correctly on the headless
 * render box (Ubuntu VPS), which has no PingFang SC / Microsoft YaHei / Songti SC.
 * Without it the composition falls back to the OS font stack, which is empty for
 * CJK on Linux, producing tofu (□) boxes. Mirrors PlatformShowcase/src/fonts.tsx.
 */

const FONT_FACE = `
@font-face {
  font-family: "Studio Sans";
  src: url("${staticFile("fonts/NotoSansSC-Variable.woff2")}") format("woff2");
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}
@font-face {
  font-family: "Studio Serif";
  src: url("${staticFile("fonts/NotoSerifSC-Variable.woff2")}") format("woff2");
  font-style: normal;
  font-weight: 400 900;
  font-display: swap;
}
@font-face {
  font-family: "ZCOOL KuaiLe";
  src: url("${staticFile("fonts/ZCOOLKuaiLe-Regular.ttf")}") format("truetype");
  font-style: normal;
  font-weight: 400;
  font-display: block;
}
`;

let injected = false;
const ensureStyle = () => {
  if (injected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.textContent = FONT_FACE;
  document.head.appendChild(style);
  injected = true;
};

export const Fonts: React.FC<{children?: React.ReactNode; loadHandwriting?: boolean}> = ({children, loadHandwriting = false}) => {
  const [handle] = useState(() => delayRender("Loading Studio fonts"));

  useEffect(() => {
    ensureStyle();
    let cancelled = false;
    const load = async () => {
      // Race the font load against a hard timeout so headless render never
      // hangs if document.fonts.load stalls for the variable woff2.
      const ready = Promise.all([
        document.fonts.load("700 16px Studio Sans"),
        document.fonts.load("700 16px Studio Serif"),
        document.fonts.load("400 16px Studio Sans"),
        ...(loadHandwriting ? [document.fonts.load("400 16px ZCOOL KuaiLe")] : []),
      ])
        .then(() => undefined)
        .catch(() => undefined);
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
      await Promise.race([ready, timeout]);
      if (!cancelled) continueRender(handle);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [handle, loadHandwriting]);

  return <>{children}</>;
};

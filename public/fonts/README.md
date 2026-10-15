# Local video fonts

These font files are vendored for deterministic Remotion preview and rendering.

- `NotoSansSC-Variable.woff2`: full Google Fonts `NotoSansSC[wght].ttf` converted losslessly to WOFF2
  - SHA-256: `2ce98082854b9bed7ebff709539f2c19eca637e6b6cd679b5195ede0d4094345`
- `NotoSerifSC-Variable.woff2`: full Google Fonts `NotoSerifSC[wght].ttf` converted losslessly to WOFF2
  - SHA-256: `47fc79b0fecf534bde115cbba28f542bb0dee360df22ded4a08950a0d0e00f13`

The corresponding SIL Open Font License texts are stored alongside the fonts.

Both fonts are embedded into the Remotion composition by `src/remotion/Fonts.tsx`
(branding them as `"Studio Sans"` / `"Studio Serif"` via `@font-face` + `staticFile`,
gated with `delayRender`/`continueRender`). They lead the font stacks in
`src/remotion/typography.ts`, so headless renders use the same Noto SC on every box
— including the Ubuntu VPS, which has none of the macOS/Windows CJK families.

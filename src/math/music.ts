export type MathMusicOption = {
  id: string;
  label: string;
};

export type MathMusicManifest = {
  options: MathMusicOption[];
};

export const MATH_MUSIC_DEFAULT_SRC = "profile-assets/tech123/math-beautiful/music/happybeat.ogg";
export const MATH_MUSIC_MANIFEST_RELATIVE_PATH = "profile-assets/tech123/math-beautiful/music/music-manifest.json";
export const MATH_MUSIC_MANIFEST_URL = `/${MATH_MUSIC_MANIFEST_RELATIVE_PATH}`;
export const DEFAULT_MATH_MUSIC_OPTIONS: MathMusicOption[] = [
  {id: MATH_MUSIC_DEFAULT_SRC, label: "Happy Beat"},
];

export const isMathMusicManifest = (value: unknown): value is MathMusicManifest => {
  if (!value || typeof value !== "object") return false;
  const options = (value as {options?: unknown}).options;
  return Array.isArray(options) && options.every((option) => (
    Boolean(option) &&
    typeof option === "object" &&
    typeof (option as {id?: unknown}).id === "string" &&
    typeof (option as {label?: unknown}).label === "string"
  ));
};

export const isAllowedMathMusicSrc = (manifest: MathMusicManifest, musicSrc: string) =>
  manifest.options.some((option) => option.id === musicSrc);

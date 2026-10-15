import { config as remotionConfig } from "@remotion/eslint-config-flat";

export default [
  ...remotionConfig,
  {
    ignores: [".next/**", "out/**", "src/remotion/templates/rve/**"],
  },
];

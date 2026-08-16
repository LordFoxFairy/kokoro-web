import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["coverage/**"] },
  ...tseslint.configs.recommended,
);

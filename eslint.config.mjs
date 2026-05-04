import js from "@eslint/js";

export default [
  {
    ignores: [".next/**", "node_modules/**", "data/**", "out/**", "public/**"]
  },
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "off"
    }
  }
];

const config = {
  devIndicators: false,
  serverExternalPackages: [
    "@e2b/code-interpreter",
    "e2b",
    "esbuild",
    "typescript",
    "tailwindcss",
    "postcss",
  ],
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/monaco/*": ["./node_modules/monaco-editor/min/vs/**/*"],
    "/api/*": ["./src/templates/instant/**/*"],
  },
};
export default config;

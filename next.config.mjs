const config = {
  devIndicators: false,
  // Bundle E2B: its CommonJS entry requires ESM-only chalk on Vercel.
  serverExternalPackages: [
    "esbuild",
    "typescript",
    "tailwindcss",
    "postcss",
    "@libsql/client",
    "@prisma/adapter-libsql",
  ],
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/monaco/*": ["./node_modules/monaco-editor/min/vs/**/*"],
    "/api/**": [
      "./src/templates/instant/**/*",
      "./node_modules/typescript/lib/*.d.ts",
      "./node_modules/@types/react/**/*",
      "./node_modules/@types/react-dom/**/*",
      "./node_modules/react/**/*",
      "./node_modules/react-dom/**/*",
      "./node_modules/lucide-react/dist/**/*",
      "./node_modules/lucide-react/package.json",
      "./node_modules/clsx/**/*",
      "./node_modules/tailwind-merge/**/*",
      "./node_modules/zod/**/*",
    ],
  },
};
export default config;

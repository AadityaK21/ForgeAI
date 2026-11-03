import type { Snapshot } from "./engine";

// Pin the toolchain for new projects so the model spends its budget on
// product behavior rather than reconstructing framework configuration.
export function applicationStarter(project: Snapshot): Snapshot {
  if (project.files["package.json"]) return project;
  const manifest = {
    name: "forge-app",
    private: true,
    version: "1.0.0",
    scripts: { dev: "next dev", build: "next build" },
    dependencies: {
      next: "15.5.28",
      react: "19.3.1",
      "react-dom": "19.3.1",
      "@prisma/client": "6.19.3",
      "lucide-react": "0.577.0",
      zod: "^4.1.0",
      clsx: "2.1.1",
      "tailwind-merge": "^3.0.0",
    },
    devDependencies: {
      prisma: "6.19.3",
      typescript: "5.9.3",
      "@types/node": "^22",
      "@types/react": "^19",
      "@types/react-dom": "^19",
      tailwindcss: "3.4.17",
      postcss: "^8.4.49",
      autoprefixer: "^10.4.20",
    },
  };
  return {
    files: {
      "package.json": JSON.stringify(manifest, null, 2),
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["dom", "dom.iterable", "esnext"],
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "preserve",
            skipLibCheck: true,
            paths: { "@/*": ["./src/*"] },
          },
          include: [
            "next-env.d.ts",
            "src/**/*.ts",
            "src/**/*.tsx",
            ".next/types/**/*.ts",
          ],
          exclude: ["node_modules"],
        },
        null,
        2,
      ),
      "next-env.d.ts":
        '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n',
      "tailwind.config.cjs":
        'module.exports={content:["./src/**/*.{tsx,ts}"],theme:{extend:{}},plugins:[]};\n',
      "postcss.config.cjs":
        "module.exports={plugins:{tailwindcss:{},autoprefixer:{}}};\n",
      "src/app/globals.css":
        "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n",
      "src/app/layout.tsx":
        'import "./globals.css";\nexport default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}\n',
      "src/lib/db.ts":
        'import {PrismaClient} from "@prisma/client";\nconst cache=globalThis as typeof globalThis & {appDb?:PrismaClient};\nexport const db=cache.appDb??new PrismaClient();\nif(process.env.NODE_ENV!=="production")cache.appDb=db;\n',
      ".env": 'DATABASE_URL="file:./dev.db"\n',
      ...project.files,
    },
    install:
      "npm install --no-fund --no-audit && mkdir -p prisma && touch prisma/dev.db && npx --no-install prisma generate && npx --no-install prisma db push --skip-generate && npm run seed --if-present",
    start: "npm run dev -- --hostname 0.0.0.0 --port 3000",
  };
}

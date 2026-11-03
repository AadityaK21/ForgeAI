import "./globals.css";
import "./forge-motion.css";
import "./forge-theme.css";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "ForgeAI | Merova",
  description:
    "Build, inspect and preview a full-stack application in a private workspace.",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script id="forge-prepaint" dangerouslySetInnerHTML={{ __html: prepaint }} />
        <link rel="preload" href="/fonts/absans-regular.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}

// Runs before the first paint. Storage is optional in private browsing.
const prepaint = `(function(){var root=document.documentElement,p;try{p=localStorage.getItem("forge-theme")}catch(e){}root.dataset.theme=p==="light"||p==="dark"?p:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";try{if(!sessionStorage.getItem("forge-mark-seen")){sessionStorage.setItem("forge-mark-seen","1");root.dataset.markIntro="true";addEventListener("pageshow",function(){setTimeout(function(){delete root.dataset.markIntro},1000)},{once:true})}}catch(e){}})();`;

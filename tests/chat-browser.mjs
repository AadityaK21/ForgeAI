import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile, open } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

// Transport fixtures are confined to this test process. The app still uses its
// real authenticated HTTP routes and database; no mocked UI endpoints exist.
const root = path.resolve(".qa/browser-" + Date.now());
await mkdir(root, { recursive: true });
const database = path.join(root, "browser.db");
await writeFile(database, "");
const origin = "http://localhost:3002";
const env = {
  ...process.env,
  DATABASE_URL: "file:" + database.replaceAll("\\", "/"),
  MEROVA_LOCAL_MODEL: "merova-qa-fixture",
  MEROVA_OLLAMA_PORT: "11435",
  BUILDER_ACCESS_TOKEN: "qa-browser-invitation",
  FORGE_PUBLIC_ORIGIN: origin,
};
for (const key of [
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "VERCEL",
])
  delete env[key];
execFileSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  { env, stdio: "pipe" },
);
const answer =
  "A simple place to start\n\nChoose one question you want to explore, then break it into smaller steps.\n\n1. Define the outcome.\n2. Gather what you know.\n3. Try one small experiment.\n\n| Step | Purpose |\n| --- | --- |\n| Ask | Find the real need |\n| Explore | Compare your options |\n\n```typescript\nconst nextStep = 'Talk to one customer';\nconsole.log(nextStep);\n```\n\nYou can also write in your own language. नमस्ते!\n\n[Learn more](https://example.com)";
let failedOnce = false;
const fixture = createServer(async (req, res) => {
  if (req.url === "/api/tags") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ models: [{ name: "merova-qa-fixture" }] }));
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const input = JSON.parse(body),
    prompt = input.messages.at(-1).content;
  if (prompt.includes("simulate-error") && !failedOnce) {
    failedOnce = true;
    res.writeHead(503);
    res.end("fixture error");
    return;
  }
  res.setHeader("Content-Type", "application/x-ndjson");
  const parts = answer.match(/.{1,40}|\n/g);
  let index = 0;
  const timer = setInterval(
    () => {
      if (index === parts.length) {
        res.end(JSON.stringify({ done: true }) + "\n");
        clearInterval(timer);
      } else
        res.write(
          JSON.stringify({ message: { content: parts[index++] } }) + "\n",
        );
    },
    prompt.includes("slow") ? 250 : 15,
  );
  res.on("close", () => clearInterval(timer));
});
await new Promise((resolve, reject) => {
  fixture.once("error", reject);
  fixture.listen(11435, "127.0.0.1", resolve);
});
const log = await open(path.join(root, "server.log"), "w");
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    process.env.CHAT_BROWSER_DEV ? "dev" : "start",
    "-p",
    "3002",
  ],
  { env, windowsHide: true, stdio: ["ignore", log.fd, log.fd] },
);
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(origin + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function audit(label) {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
      [],
      label,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      label + " horizontal overflow",
    );
    console.log("PASS " + label);
  }
  await page.goto(origin);
  await page
    .getByRole("heading", { name: "What's on your mind today?" })
    .waitFor();
  await page.screenshot({ path: path.join(root, "desktop-empty.png") });
  await audit("desktop empty");
  await page.goto(origin + "/sign-up");
  await page.getByLabel("Email address").fill("browser@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Browser!2026");
  await page.getByLabel("Invitation code").fill("qa-browser-invitation");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.waitForURL(origin + "/");
  await page
    .getByRole("button", { name: "Model settings", exact: true })
    .click();
  await page.getByLabel("Provider", { exact: true }).selectOption("local");
  await page.getByRole("button", { name: "Load available models" }).click();
  await page
    .getByLabel("Model", { exact: true })
    .selectOption("merova-qa-fixture");
  await audit("model settings dialog");
  await page.getByRole("button", { name: "Apply settings" }).click();
  await page
    .getByRole("dialog", { name: "Model & API settings" })
    .waitFor({ state: "hidden" });
  await page
    .getByRole("textbox", { name: "Message Merova AI" })
    .fill("Help me think through my idea");
  await page.getByRole("button", { name: "Send message" }).click();
  await page
    .getByRole("button", { name: "Copy message", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Stop response" })
    .waitFor({ state: "hidden" });
  assert.equal(await page.locator("table").count(), 1);
  await page.getByRole("button", { name: "Copy code", exact: true }).click();
  assert.match(
    await page.evaluate(() => navigator.clipboard.readText()),
    /nextStep/,
  );
  await audit("desktop active markdown");
  const id = new URL(page.url()).searchParams.get("chat");
  await page.screenshot({ path: path.join(root, "desktop-chat.png") });
  await page.reload();
  await page
    .getByRole("button", { name: "Copy message", exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).searchParams.get("chat"), id);
  await page
    .getByRole("button", { name: "Rename Help me think through my idea" })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("My saved conversation");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page
    .getByRole("heading", { name: "What's on your mind today?" })
    .waitFor();
  await page
    .getByRole("textbox", { name: "Search conversations", exact: true })
    .fill("saved");
  await page
    .getByRole("button", { name: "My saved conversation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Copy message", exact: true })
    .waitFor();
  await page
    .getByRole("textbox", { name: "Message Merova AI" })
    .fill("simulate-error");
  await page.getByRole("button", { name: "Send message" }).click();
  await page
    .getByRole("button", { name: "Retry response", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Stop response" })
    .waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByRole("button", { name: "Copy message", exact: true })
      .count(),
    2,
  );
  await page
    .getByRole("textbox", { name: "Message Merova AI" })
    .fill("slow reply");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.locator(".assistant-message").nth(2).waitFor();
  await page.getByRole("button", { name: "Stop response" }).click();
  await page
    .getByRole("button", { name: "Retry response", exact: true })
    .waitFor();
  console.log(
    "PASS signup, streaming, markdown, copy, refresh, rename, search, reopen, retry, stop",
  );
  await page.setViewportSize({ width: 390, height: 480 });
  const compactComposer = await page.locator(".composer").boundingBox();
  assert.ok(
    compactComposer.y + compactComposer.height <= 480,
    "composer stays visible in a shortened viewport",
  );
  for (const width of [375, 768, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await audit(width + " active layout");
    const composer = await page.locator(".composer").boundingBox();
    assert.ok(composer.y + composer.height <= 900);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await audit("mobile drawer");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.screenshot({ path: path.join(root, "mobile-empty.png") });
  await audit("mobile empty");
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await page
    .getByRole("button", { name: "Delete My saved conversation" })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete conversation?" })
    .waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL(origin + "/sign-in");
  await audit("mobile sign in");
  await page.getByLabel("Email address").fill("browser@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Browser!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(origin + "/");
  assert.deepEqual(errors, []);
  console.log("PASS deletion, sign out, sign in, no browser errors");
  console.log("Evidence: " + root);
} finally {
  if (browser)
    await browser
      .contexts()[0]
      ?.pages()[0]
      ?.screenshot({ path: path.join(root, "last-state.png") })
      .catch(() => {});
  await browser?.close();
  server.kill();
  fixture.closeAllConnections();
  await new Promise((r) => fixture.close(r));
  await log.close();
}

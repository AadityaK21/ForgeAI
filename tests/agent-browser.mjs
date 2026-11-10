import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile, open } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(".qa/agent-browser-" + Date.now());
await mkdir(root, { recursive: true });
const database = path.join(root, "browser.db");
await writeFile(database, "");
const origin = "http://localhost:3003";
const env = {
  ...process.env,
  DATABASE_URL: "file:" + database.replaceAll("\\", "/"),
  BUILDER_ACCESS_TOKEN: "qa-agent-invitation",
  FORGE_PUBLIC_ORIGIN: origin,
  OPENAI_API_KEY: "sk-fixture-not-a-real-key",
  OPENAI_BASE_URL: "http://127.0.0.1:11436/v1",
  AGENT_REQUESTS_PER_MINUTE: "30",
  AGENT_MODEL_BUDGETS: JSON.stringify({
    "gpt-5.4-mini": { input: 1, output: 4, context: 32000 },
  }),
};
for (const key of [
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "MEROVA_LOCAL_MODEL",
  "VERCEL",
])
  delete env[key];
execFileSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  { env, stdio: "pipe" },
);
const fixture = createServer(async (req, res) => {
  if (req.url === "/v1/models") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ object: "list", data: [{ id: "gpt-5.4-mini" }] }));
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const input = JSON.parse(body);
  const remember = input.input
    .filter((i) => i.role === "user")
    .at(-1)
    ?.content?.includes("remember");
  const observed = input.input.some((i) => i.type === "function_call_output");
  res.setHeader("Content-Type", "text/event-stream");
  const text = "The result is 60.";
  if (observed)
    res.write(
      "data: " +
        JSON.stringify({ type: "response.output_text.delta", delta: text }) +
        "\n\n",
    );
  res.end(
    "data: " +
      JSON.stringify({
        type: "response.completed",
        response: {
          status: "completed",
          usage: { input_tokens: 100, output_tokens: 20 },
          output: observed
            ? [
                {
                  type: "message",
                  id: "msg",
                  role: "assistant",
                  status: "completed",
                  content: [{ type: "output_text", text, annotations: [] }],
                },
              ]
            : [
                {
                  type: "function_call",
                  call_id: "calc",
                  name: remember ? "save_memory" : "calculator",
                  arguments: remember
                    ? '{"category":"tone","value":"Friendly"}'
                    : '{"expression":"(12+3)*4"}',
                },
              ],
        },
      }) +
      "\n\n",
  );
});
await new Promise((resolve, reject) => {
  fixture.once("error", reject);
  fixture.listen(11436, "127.0.0.1", resolve);
});
const log = await open(path.join(root, "server.log"), "w");
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", "3003"],
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
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/sign-up");
  await page.getByLabel("Email address").fill("agent-browser@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Browser!2026");
  await page.getByLabel("Invitation code").fill("qa-agent-invitation");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.waitForURL(origin + "/");
  const toggle = page.getByRole("checkbox", { name: "Agent mode" });
  assert.equal(await toggle.isChecked(), false);
  await toggle.check();
  await page
    .getByRole("textbox", { name: "Message Merova AI" })
    .fill("Calculate (12+3)*4");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByText("Agent: done", { exact: false }).waitFor();
  await page.locator(".agent-steps summary").click();
  await page.getByRole("button", { name: "Read full saved output" }).click();
  await page
    .locator(".agent-steps pre")
    .filter({ hasText: /^60$/ })
    .last()
    .waitFor();
  await page.reload();
  await page.getByText("Agent: done", { exact: false }).waitFor();
  assert.equal(await toggle.isChecked(), true);
  assert.equal(await page.locator(".agent-steps summary").count(), 1);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator(".agent-steps details").evaluate((el) => {
      el.open = true;
    });
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      audit.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
      [],
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: path.join(root, `agent-${width}.png`) });
    console.log(
      `PASS agent cards, sources layout and accessibility at ${width}px`,
    );
  }
  await toggle.uncheck();
  await page.waitForTimeout(300);
  await page.reload();
  await page.getByText("Agent: done", { exact: false }).waitFor();
  assert.equal(await toggle.isChecked(), false);
  await page
    .getByRole("button", { name: "Model settings", exact: true })
    .click();
  const memoryToggle = page.getByRole("checkbox", {
    name: "Use preference memory",
  });
  assert.equal(await memoryToggle.isChecked(), false);
  await memoryToggle.check();
  await page.getByText("Memory setting updated.", { exact: true }).waitFor();
  await page
    .getByLabel("Preference type", { exact: true })
    .selectOption("detail");
  await page
    .getByLabel("Preference value", { exact: true })
    .selectOption("Concise");
  await page
    .getByRole("button", { name: "Save preference", exact: true })
    .click();
  await page
    .getByText("Preference saved for 180 days.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Edit detail", exact: true }).click();
  await page
    .getByLabel("Preference value", { exact: true })
    .selectOption("Detailed");
  await page
    .getByRole("button", { name: "Save preference", exact: true })
    .click();
  await page.getByText("detail: Detailed", { exact: true }).waitFor();
  const memoryAudit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    memoryAudit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
  );
  await page.screenshot({ path: path.join(root, "memory-mobile.png") });
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await toggle.check();
  await page
    .getByRole("textbox", { name: "Message Merova AI" })
    .fill("Please remember I prefer a friendly tone");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByText("Agent: needs user input", { exact: false }).waitFor();
  await page
    .locator(".agent-steps summary")
    .filter({ hasText: "save memory" })
    .click();
  const beforeSave = await page.request.get(origin + "/api/memories");
  assert.equal(
    (await beforeSave.json()).memories.some((m) => m.category === "tone"),
    false,
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const confirmationAudit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      confirmationAudit.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
      [],
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: path.join(root, `confirmation-${width}.png`),
    });
  }
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByText("Saved to memory", { exact: true }).waitFor();
  await page
    .locator(".agent-steps")
    .last()
    .getByText("Agent: done", { exact: false })
    .waitFor();
  await page.getByText("Action: completed.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByText("Memory save undone", { exact: true }).waitFor();
  const undone = await page.request.get(origin + "/api/memories");
  assert.equal(
    (await undone.json()).memories.some((m) => m.category === "tone"),
    false,
  );
  await page
    .getByRole("textbox", { name: "Message Merova AI" })
    .fill("Please remember I prefer a friendly tone");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByRole("button", { name: "Deny", exact: true }).waitFor();
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await page.getByText("Action: denied.", { exact: true }).waitFor();
  const denied = await page.request.get(origin + "/api/memories");
  assert.equal(
    (await denied.json()).memories.some((m) => m.category === "tone"),
    false,
  );
  await page.screenshot({ path: path.join(root, "confirmation-mobile.png") });
  await page
    .getByRole("button", { name: "Model settings", exact: true })
    .click();
  await page.getByText("detail: Detailed", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Delete all preferences", exact: true })
    .click();
  await page
    .getByText("All saved preferences deleted.", { exact: true })
    .waitFor();
  await memoryToggle.uncheck();
  await page.getByText("Memory setting updated.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Model settings", exact: true })
    .click();
  await page.getByText("No preferences saved.", { exact: true }).waitFor();
  assert.equal(await memoryToggle.isChecked(), false);
  console.log(
    "PASS preference opt-in, save, edit, proposal approval, delete, reload and mobile accessibility",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS agent stream, saved output, reload and per-chat toggle. Evidence: " +
      root,
  );
} finally {
  await browser?.close();
  server.kill();
  fixture.closeAllConnections();
  await new Promise((r) => fixture.close(r));
  await log.close();
}

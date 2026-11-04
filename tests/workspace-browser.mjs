// npm ci installs the browser QA dependencies. FORGE_QA_MODULES optionally
// reuses an existing directory containing playwright and @axe-core/playwright.
// BASE_URL defaults to the local builder. Optional FORGE_QA_INVITE enables the
// account flow ONLY on a disposable local server with a dedicated SQLite DB.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const requireQA = createRequire(process.env.FORGE_QA_MODULES
  ? join(process.env.FORGE_QA_MODULES, "forge-qa.cjs") : import.meta.url);
const { chromium } = requireQA("playwright");
const AxeBuilder = requireQA("@axe-core/playwright").default;
const base = process.env.BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const issues = new Set();
const routeErrors = [];
const shots = process.env.FORGE_QA_SCREENSHOTS;
const phases = new Set();
let checked = 0, audits = 0;
if (shots) await mkdir(shots, { recursive: true });

function observeFirstTheme() {
  const observer = new MutationObserver(() => {
    if (!document.body) return;
    window.__themeBeforeBody = document.documentElement.dataset.theme;
    window.__markBeforeBody = document.documentElement.hasAttribute("data-mark-intro");
    observer.disconnect();
  });
  observer.observe(document, { childList: true, subtree: true });
}

async function audit(page, label) {
  const findings = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  for (const finding of findings.violations) {
    for (const node of finding.nodes) issues.add(label + " " + finding.id + " " + node.target.join(" "));
  }
  audits++;
}

async function layout(page, route, width, theme) {
  const response = await page.goto(base + route, {waitUntil: "load"});
  assert.equal(response?.status(), 200);
  await page.evaluate(() => document.fonts.ready);
  const state = await page.evaluate(() => ({
    early: window.__themeBeforeBody,
    theme: document.documentElement.dataset.theme,
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    loaded: [...document.fonts].some(f => /absans/i.test(f.family) && f.status === "loaded")
  }));
  assert.equal(state.early, theme, "prepaint theme at " + route);
  assert.equal(state.theme, theme);
  assert(state.overflow <= width, route + " overflows by " + (state.overflow - width));
  assert(state.loaded, route + " should use local Absans");
  if (await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)) {
    assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length), 0, "reduced motion stops movement");
  }
  checked++;
}

async function demo(page, motion) {
  await page.getByRole("button", {name: /watch (a|an|ai) build/i}).first().click();
  const panel = page.locator("[data-demo-phase]");
  await panel.waitFor();
  const noMotion = motion === "reduce";
  if (noMotion) {
    assert.equal(await panel.getAttribute("data-demo-phase"), "done");
    assert.equal(await panel.getAttribute("data-playing"), "false");
  }
  await panel.getByRole("tab", {name: "Mark"}).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await panel.getByRole("tab", {name:"Pixel pet"}).getAttribute("aria-selected"), "true");
  await panel.getByRole("button", {name:"Replay"}).click();
  await panel.locator('[aria-current="step"]').waitFor();
  await panel.evaluate(el => {
    window.__forgeQAFrames = [el.dataset.demoPhase];
    const observer = new MutationObserver(() => window.__forgeQAFrames.push(el.dataset.demoPhase));
    observer.observe(el, { attributes: true, attributeFilter: ["data-demo-phase"] });
  });
  await page.waitForFunction(() => document.querySelector("[data-demo-phase]")?.dataset.demoPhase === "done", null, {timeout:15000});
  const observed = await page.evaluate(() => window.__forgeQAFrames);
  for (const phase of observed) phases.add(phase);
  assert(observed.length >= 3, "demo should render intermediate build stages");
  await audit(page, "guided example " + motion);
  if (shots) await page.screenshot({path: join(shots, "demo-" + motion + ".png")});
  await panel.getByRole("button", {name:"Light", exact:true}).click();
  assert.equal(await panel.locator("article").getAttribute("data-roast"),"light");
  await panel.getByRole("button", {name:"Use this brief"}).click();
  assert.match(await page.locator("textarea#brief").inputValue(), /Index Coffee/i);
  assert.equal(await page.locator("[data-demo-phase]").count(), 0);
}

async function checkContext(width, theme, motion) {
  const context = await browser.newContext({
    viewport: {width, height: 850}, colorScheme: theme, reducedMotion: motion,
    hasTouch: width === 375
  });
  try {
    await context.addInitScript(observeFirstTheme);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(45000);
    page.on("pageerror", e => routeErrors.push(page.url() + " " + e.message));
    for (const route of ["/", "/sign-in", "/sign-up"]) {
      await layout(page, route, width, theme);
      if (width === 375 && motion === "reduce") await audit(page, theme + " " + route);
      if (shots && (width === 375 || width === 1280) && motion === "reduce") {
        await page.screenshot({ path: join(shots, width + "-" + theme + "-" + (route.slice(1) || "workspace") + ".png") });
      }
    }
    await page.goto(base);
    const toggle = page.getByRole("button", {name:"Dark theme",exact:true}).first();
    await toggle.click();
    const nextTheme = theme === "light" ? "dark":"light";
    await page.reload();
    assert.equal(await page.evaluate(() => window.__themeBeforeBody), nextTheme, "persist across reload");
    await toggle.click();

    if (motion === "reduce" && (width === 375 || width === 1280)) {
      const openSettings = page.getByRole("button", {name:/API key settings|Settings \/ API keys/i}).first();
      await openSettings.click();
      const dialog = page.getByRole("dialog");
      assert(await dialog.isVisible());
      if (width === 375) await audit(page, theme + " settings");
      await page.keyboard.press("Escape");
      await dialog.waitFor({state:"hidden"});
      assert(await openSettings.evaluate(el => el === document.activeElement), "restore opener focus");
      if (width === 375) {
        await page.getByRole("button",{name:/open workspace menu/i}).click();
        await page.getByRole("dialog").getByRole("button",{name:"History",exact:true}).click();
        assert(await page.getByRole("heading",{name:/run history/i}).isVisible());
        await page.goto(base);
      }
    }
    if ((width === 375 && motion === "reduce") || (width === 1280 && motion === "no-preference")) await demo(page, motion);
  } finally { await context.close(); }
}

async function isolatedAccount() {
  const url = new URL(base);
  assert(["127.0.0.1","localhost"].includes(url.hostname) && url.port && url.port !== "3000", "Use a disposable loopback port and database for accounts");
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.on("pageerror", error => routeErrors.push(page.url() + " " + error.message));
    await page.goto(base + "/sign-up");
    const email = "forge-qa-" + Date.now() + "@example.test";
    await page.getByLabel("Email address").fill(email);
    await page.locator("#account-password").fill("Forge-QA-only-727!");
    await page.locator('[name="invite"]').fill(process.env.FORGE_QA_INVITE);
    await page.getByRole("button", {name:"Create account",exact:true}).click();
    await page.waitForURL(base + "/");
    await page.getByRole("button",{name:"New project",exact:true}).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Project name").fill("Disposable QA brief");
    await dialog.getByRole("button",{name:"Create project",exact:true}).click();
    await dialog.waitFor({state:"hidden"});
    const projects = await (await context.request.get(base + "/api/projects")).json();
    assert(projects.projects.some(p => p.title === "Disposable QA brief"), "project stored by the real API");
    await page.getByRole("button",{name:"Sign out",exact:true}).click();
    await page.waitForURL(base + "/", {waitUntil:"load"});
    await page.getByRole("link", {name:"Sign in",exact:true}).waitFor();
    await page.goto(base + "/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.locator("#account-password").fill("Forge-QA-only-727!");
    await page.getByRole("button",{name:"Sign in",exact:true}).click();
    await page.waitForURL(base + "/");
    await page.getByRole("button", {name: "First project", exact: true}).click();
    await page.getByRole("button", {name: "Workbench", exact: true}).click();
    await page.getByRole("button", {name: "Code", exact: true}).click();
    await page.getByRole("button", {name: "BRIEF.md", exact: true}).waitFor();
    await page.locator(".monaco-editor").waitFor();
    const editorBackground = () => page.locator(".monaco-editor").first().evaluate(el => getComputedStyle(el).backgroundColor);
    const lightEditor = await editorBackground();
    await page.getByRole("button", {name: "Dark theme", exact: true}).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".monaco-editor")).backgroundColor === getComputedStyle(document.body).backgroundColor);
    assert.notEqual(await editorBackground(), lightEditor, "Monaco follows the workbench theme");
    await page.getByRole("button", {name: "Plain text", exact: true}).click();
    assert.match(await page.getByRole("textbox", {name:"Source code",exact:true}).inputValue(), /Project brief/);
    await audit(page, "authenticated code inspector");
    await page.getByRole("button", {name: "Data & API", exact: true}).click();
    await page.getByRole("button", {name: "Terminal", exact: true}).click();
    await page.getByRole("button", {name: "Agent", exact: true}).click();
    await page.locator("#brief").fill("Build a coffee catalogue in a local store.");
    await page.getByRole("button",{name:"Run build",exact:true}).click();
    assert(await page.getByRole("dialog").isVisible(), "absent provider should open real settings");
    console.log("Disposable account: registered, created project, signed out/in, inspected saved files in both themes, opened data/terminal tabs and missing-provider setup.");
  } finally { await context.close(); }
}

async function lifecycle() {
  const context = await browser.newContext({viewport: {width: 1280, height: 200}, reducedMotion: "no-preference"});
  try {
    await context.addInitScript(observeFirstTheme);
    const page = await context.newPage();
    await page.goto(base);
    assert(await page.evaluate(() => window.__markBeforeBody), "first session animates the mark");
    await page.reload();
    assert.equal(await page.evaluate(() => window.__markBeforeBody), false, "reload does not repeat the mark intro");
    await page.getByRole("button", {name: "Watch a build", exact: true}).click();
    const panel = page.locator("[data-demo-phase]");
    await panel.scrollIntoViewIfNeeded();
    await panel.getByRole("button", {name: "Replay", exact: true}).click();
    await page.waitForFunction(() => document.querySelector("[data-demo-phase]")?.dataset.demoPhase === "done");
    await page.waitForFunction(() => document.querySelector("[data-demo-phase]")?.dataset.demoPhase === "brief", null, {timeout: 10000});
    console.log("Lifecycle: autoplay completed and looped.");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForFunction(() => document.querySelector("[data-demo-phase]").getBoundingClientRect().bottom <= 0);
    await page.waitForFunction(() => document.querySelector("[data-demo-phase]")?.dataset.playing === "false");
    const paused = await panel.getAttribute("data-demo-phase");
    await page.waitForTimeout(1300);
    assert.equal(await panel.getAttribute("data-demo-phase"), paused, "timeline stops offscreen");
    await panel.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector("[data-demo-phase]")?.dataset.playing === "true");
    // Simulate the browser's visibility signal to verify the listener without
    // relying on a window manager to background a headless tab.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {configurable: true, value: true});
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForFunction(() => document.querySelector("[data-demo-phase]")?.dataset.playing === "false");
    const hiddenPhase = await panel.getAttribute("data-demo-phase");
    await page.waitForTimeout(1300);
    assert.equal(await panel.getAttribute("data-demo-phase"), hiddenPhase, "timeline stops on hidden-tab signal");
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
    await page.waitForFunction(() => document.querySelector("[data-demo-phase]")?.dataset.playing === "true");
    await panel.getByRole("button", {name: "Pause", exact: true}).click();
    assert.equal(await panel.getAttribute("data-playing"), "false");
    await panel.getByRole("button", {name: "Close build demo"}).click();
    assert(await page.getByRole("button", {name: "Watch a build", exact:true}).evaluate(el => el === document.activeElement));
    console.log("Motion: session intro, full loop, offscreen pause, visibility signal, manual pause and close focus passed.");
  } finally { await context.close(); }

  const restricted = await browser.newContext({colorScheme: "dark", reducedMotion: "reduce"});
  try {
    await restricted.addInitScript(() => {
      for (const key of ["getItem", "setItem", "removeItem"]) Storage.prototype[key] = () => { throw new DOMException("Storage disabled", "SecurityError"); };
    });
    const page = await restricted.newPage();
    page.on("pageerror", error => routeErrors.push(error.message));
    await page.goto(base);
    await page.getByRole("button", {name: "Dark theme", exact:true}).first().click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
    await page.locator("#brief").fill("Build a reading list for my team.");
    await page.getByRole("button", {name: "Run build", exact:true}).click();
    await page.waitForURL(base + "/sign-in");
    console.log("Restricted storage: theme toggle and account navigation passed.");
  } finally { await restricted.close(); }
}

try {
  for (const width of process.env.FORGE_QA_ACCOUNT_ONLY || process.env.FORGE_QA_LIFECYCLE_ONLY ? [] : [375, 768, 1280, 1920]) {
    for (const theme of ["light","dark"]) {
      for (const motion of ["reduce","no-preference"]) {
        try { await checkContext(width, theme, motion); }
        catch (e) { issues.add(width + " " + theme + " " + motion + ": " + e.message); }
        console.log("Checked", width, theme, motion);
      }
    }
  }
  if (process.env.FORGE_QA_INVITE) await isolatedAccount();
  if (!process.env.FORGE_QA_ACCOUNT_ONLY) {
    try { await lifecycle(); } catch (error) { issues.add("Lifecycle: " + error.message); }
  }
  for (const error of routeErrors) issues.add(error);
  console.log(checked + "/48 route/layout checks, " + audits + " WCAG A/AA audits. Observed demo phases:", [...phases]);
  for (const issue of issues) console.error(issue);
  if (issues.size || (!process.env.FORGE_QA_ACCOUNT_ONLY && !process.env.FORGE_QA_LIFECYCLE_ONLY && checked !== 48)) process.exitCode = 1;
} finally { await browser.close(); }

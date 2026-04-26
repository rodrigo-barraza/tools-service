// ============================================================
// Agentic Browser Service — Headless Playwright Automation
// ============================================================
// Manages a singleton Chromium browser with per-session pages.
// Each session is a unique page context with auto-cleanup.
//
// Actions: navigate, screenshot, click, type, scroll,
//          evaluate, get_content, get_elements, wait, close,
//          snapshot, click_ref, type_ref, hover_ref, select_ref,
//          run_script
// ============================================================

import { chromium } from "playwright";
import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import logger from "../logger.js";

// ────────────────────────────────────────────────────────────
// Session Management
// ────────────────────────────────────────────────────────────

/** @type {import('playwright').Browser | null} */
let browser = null;

/** @type {Map<string, { page: import('playwright').Page, lastUsed: number }>} */
const sessions = new Map();

const MAX_SESSIONS = 3;
const SESSION_IDLE_MS = 5 * 60_000; // 5 minutes
const VIEWPORT = { width: 1280, height: 720 };

let cleanupInterval = null;

/**
 * Get or launch the singleton browser instance.
 */
async function getBrowser() {
  if (browser && browser.isConnected()) return browser;

  // Browser died or never existed — purge all stale sessions that belonged
  // to the old instance before launching a fresh one
  if (sessions.size > 0) {
    logger.warn(`[AgenticBrowser] Browser disconnected, purging ${sessions.size} stale sessions`);
    sessions.clear();
  }

  browser = await chromium.launch({
    headless: true,
    // In Docker, system Chromium is used instead of Playwright's bundled browser
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    }),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  // Start idle cleanup if not already running
  if (!cleanupInterval) {
    cleanupInterval = setInterval(cleanupIdleSessions, 30_000);
    cleanupInterval.unref?.(); // Don't keep process alive
  }

  logger.info("[AgenticBrowser] Chromium launched");
  return browser;
}

/**
 * Get or create a session page.
 */
async function getSession(sessionId) {
  if (sessions.has(sessionId)) {
    const session = sessions.get(sessionId);

    // Validate the cached session is still alive — the page or browser context
    // may have been closed externally (manual window close, browser crash, etc.)
    const pageAlive = session.page && !session.page.isClosed();
    const browserAlive = browser && browser.isConnected();

    if (pageAlive && browserAlive) {
      session.lastUsed = Date.now();
      return session;
    }

    // Stale session — evict silently and fall through to create a new one
    logger.warn(`[AgenticBrowser] Session "${sessionId}" stale (page=${pageAlive}, browser=${browserAlive}), recreating`);
    try { await session.context.close(); } catch { /* already dead */ }
    sessions.delete(sessionId);
  }

  if (sessions.size >= MAX_SESSIONS) {
    // Evict oldest session
    let oldestId = null;
    let oldestTime = Infinity;
    for (const [id, s] of sessions) {
      if (s.lastUsed < oldestTime) {
        oldestTime = s.lastUsed;
        oldestId = id;
      }
    }
    if (oldestId) await closeSession(oldestId);
  }

  const b = await getBrowser();
  const context = await b.newContext({
    viewport: VIEWPORT,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  const session = { page, context, lastUsed: Date.now() };
  sessions.set(sessionId, session);

  logger.info(`[AgenticBrowser] Session "${sessionId}" created (${sessions.size}/${MAX_SESSIONS})`);
  return session;
}


/**
 * Close and clean up a session.
 */
async function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;

  try {
    await session.context.close();
  } catch { /* page may already be closed */ }
  sessions.delete(sessionId);
  logger.info(`[AgenticBrowser] Session "${sessionId}" closed (${sessions.size}/${MAX_SESSIONS})`);
  return true;
}

/**
 * Clean up sessions idle for > SESSION_IDLE_MS.
 */
function cleanupIdleSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastUsed > SESSION_IDLE_MS) {
      logger.info(`[AgenticBrowser] Evicting idle session "${id}"`);
      closeSession(id);
    }
  }

  // Stop cleanup interval if no sessions and no browser
  if (sessions.size === 0 && browser && !browser.isConnected()) {
    browser = null;
  }
}

// ────────────────────────────────────────────────────────────
// Action Handlers
// ────────────────────────────────────────────────────────────

async function actionNavigate(page, { url }) {
  if (!url) return { error: "Missing required parameter: url" };

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    // Wait a bit more for dynamic content
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

    return {
      action: "navigate",
      url: page.url(),
      title: await page.title(),
      status: response?.status() || null,
    };
  } catch (err) {
    return { error: `Navigation failed: ${err.message}` };
  }
}

async function actionScreenshot(page, { fullPage, selector }) {
  try {
    let screenshotBuffer;
    if (selector) {
      const element = await page.$(selector);
      if (!element) return { error: `Element not found: ${selector}` };
      screenshotBuffer = await element.screenshot({ type: "png" });
    } else {
      screenshotBuffer = await page.screenshot({
        type: "png",
        fullPage: fullPage === true,
      });
    }

    return {
      action: "screenshot",
      url: page.url(),
      title: await page.title(),
      screenshot: screenshotBuffer.toString("base64"),
      mimeType: "image/png",
    };
  } catch (err) {
    return { error: `Screenshot failed: ${err.message}` };
  }
}

async function actionClick(page, { selector }) {
  if (!selector) return { error: "Missing required parameter: selector" };

  try {
    await page.click(selector, { timeout: 10_000 });

    // Wait for potential navigation or re-render
    await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});

    return {
      action: "click",
      selector,
      url: page.url(),
      title: await page.title(),
    };
  } catch (err) {
    return { error: `Click failed on "${selector}": ${err.message}` };
  }
}

async function actionType(page, { selector, text, pressEnter }) {
  if (!selector) return { error: "Missing required parameter: selector" };
  if (text === undefined || text === null) return { error: "Missing required parameter: text" };

  try {
    // Clear existing content and type new text
    await page.fill(selector, "", { timeout: 10_000 });
    await page.fill(selector, text, { timeout: 10_000 });

    if (pressEnter) {
      await page.press(selector, "Enter");
      await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
    }

    return {
      action: "type",
      selector,
      text,
      pressEnter: pressEnter || false,
      url: page.url(),
      title: await page.title(),
    };
  } catch (err) {
    return { error: `Type failed on "${selector}": ${err.message}` };
  }
}

async function actionScroll(page, { direction, selector, amount }) {
  try {
    if (selector) {
      await page.evaluate(
        ({ sel }) => {
          // eslint-disable-next-line no-undef
          const el = document.querySelector(sel);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        },
        { sel: selector },
      );
    } else {
      const pixels = amount || 500;
      const delta = direction === "up" ? -pixels : pixels;
      // eslint-disable-next-line no-undef
      await page.evaluate((d) => window.scrollBy(0, d), delta);
    }

    // Small delay for scroll animation
    await page.waitForTimeout(300);

    return {
      action: "scroll",
      direction: selector ? "to element" : (direction || "down"),
      url: page.url(),
    };
  } catch (err) {
    return { error: `Scroll failed: ${err.message}` };
  }
}

async function actionEvaluate(page, { expression }) {
  if (!expression) return { error: "Missing required parameter: expression" };

  try {
    const result = await page.evaluate(expression);

    return {
      action: "evaluate",
      result: typeof result === "object" ? JSON.stringify(result, null, 2) : String(result),
      url: page.url(),
    };
  } catch (err) {
    return { error: `Evaluate failed: ${err.message}` };
  }
}

async function actionGetContent(page, { selector, format }) {
  try {
    let content;

    if (format === "html") {
      content = selector
        ? await page.$eval(selector, (el) => el.innerHTML).catch(() => null)
        : await page.content();
    } else {
      // Default: extract text content
      content = selector
        ? await page.$eval(selector, (el) => el.innerText).catch(() => null)
        // eslint-disable-next-line no-undef
        : await page.evaluate(() => document.body.innerText);
    }

    if (content === null) {
      return { error: `Element not found: ${selector}` };
    }

    // Truncate to 100k chars (same as fetch_url)
    const maxLen = 100_000;
    const truncated = content.length > maxLen;
    if (truncated) content = content.slice(0, maxLen);

    return {
      action: "get_content",
      format: format || "text",
      url: page.url(),
      title: await page.title(),
      content,
      length: content.length,
      truncated,
    };
  } catch (err) {
    return { error: `Content extraction failed: ${err.message}` };
  }
}

async function actionWait(page, { selector, timeout, state }) {
  try {
    if (selector) {
      await page.waitForSelector(selector, {
        timeout: timeout || 10_000,
        state: state || "visible",
      });
      return {
        action: "wait",
        waited_for: `selector: ${selector}`,
        url: page.url(),
      };
    }

    // Wait for timeout duration
    const waitMs = Math.min(timeout || 2_000, 30_000);
    await page.waitForTimeout(waitMs);
    return {
      action: "wait",
      waited_for: `${waitMs}ms`,
      url: page.url(),
    };
  } catch (err) {
    return { error: `Wait failed: ${err.message}` };
  }
}

async function actionGetElements(page, { selector, limit }) {
  try {
    const maxElements = Math.min(limit || 50, 100);
    const scope = selector || "body";

    const elements = await page.evaluate(
      ({ scope, max }) => {
        // eslint-disable-next-line no-undef
        const root = document.querySelector(scope) || document.body;

        // All interactive elements worth reporting to an LLM
        const interactiveSelectors = [
          "a[href]",
          "button",
          "input",
          "textarea",
          "select",
          "[role='button']",
          "[role='link']",
          "[role='tab']",
          "[role='menuitem']",
          "[role='checkbox']",
          "[role='radio']",
          "[role='switch']",
          "[role='combobox']",
          "[role='searchbox']",
          "[role='textbox']",
          "[contenteditable='true']",
        ];

        const allElements = root.querySelectorAll(interactiveSelectors.join(", "));
        const results = [];

        for (const el of allElements) {
          if (results.length >= max) break;

          // Skip invisible elements
          const rect = el.getBoundingClientRect();
          // eslint-disable-next-line no-undef
          const style = window.getComputedStyle(el);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            (rect.width === 0 && rect.height === 0)
          ) continue;

          // Build the best CSS selector for this element
          let cssSelector = "";
          if (el.id) {
            cssSelector = `#${el.id}`;
          } else if (el.getAttribute("data-testid")) {
            cssSelector = `[data-testid="${el.getAttribute("data-testid")}"]`;
          } else if (el.getAttribute("name")) {
            cssSelector = `${el.tagName.toLowerCase()}[name="${el.getAttribute("name")}"]`;
          } else if (el.getAttribute("aria-label")) {
            cssSelector = `[aria-label="${el.getAttribute("aria-label")}"]`;
          } else if (el.className && typeof el.className === "string") {
            // Use first meaningful class
            const cls = el.className.trim().split(/\s+/)[0];
            if (cls) cssSelector = `${el.tagName.toLowerCase()}.${cls}`;
          }

          // Fallback: tag + nth-of-type
          if (!cssSelector) {
            cssSelector = el.tagName.toLowerCase();
          }

          const text = (el.innerText || el.textContent || "").trim().slice(0, 80);
          const tag = el.tagName.toLowerCase();
          const entry = { tag, selector: cssSelector };

          if (text) entry.text = text;
          if (el.getAttribute("type")) entry.type = el.getAttribute("type");
          if (el.getAttribute("placeholder")) entry.placeholder = el.getAttribute("placeholder");
          if (el.getAttribute("href")) entry.href = el.getAttribute("href").slice(0, 120);
          if (el.getAttribute("value")) entry.value = el.getAttribute("value").slice(0, 60);
          if (el.getAttribute("role")) entry.role = el.getAttribute("role");
          if (el.disabled) entry.disabled = true;
          if (el.getAttribute("aria-label")) entry.ariaLabel = el.getAttribute("aria-label");

          results.push(entry);
        }

        return results;
      },
      { scope, max: maxElements },
    );

    return {
      action: "get_elements",
      url: page.url(),
      title: await page.title(),
      count: elements.length,
      elements,
    };
  } catch (err) {
    return { error: `Get elements failed: ${err.message}` };
  }
}

// ────────────────────────────────────────────────────────────
// Accessibility Snapshot Actions
// ────────────────────────────────────────────────────────────

/**
 * Capture an ARIA accessibility tree snapshot of the page.
 *
 * Returns a YAML-like text representation of the page's accessibility tree
 * with roles, names, states, and ref IDs for interactive elements.
 * This is ~4x more token-efficient than screenshots for LLM page understanding.
 *
 * Ref IDs (e.g. [ref=s1e5]) can be used with click_ref/type_ref actions.
 */
async function actionSnapshot(page, { selector }) {
  try {
    const locator = selector ? page.locator(selector) : page.locator("body");

    // Playwright ≥1.49 supports locator.ariaSnapshot()
    if (typeof locator.ariaSnapshot === "function") {
      const snapshot = await locator.ariaSnapshot();
      return {
        action: "snapshot",
        url: page.url(),
        title: await page.title(),
        snapshot,
        format: "aria",
      };
    }

    // Fallback: use page.accessibility.snapshot() + format ourselves
    const tree = await page.accessibility.snapshot({ interestingOnly: true });
    const formatted = formatAccessibilityTree(tree, 0);
    return {
      action: "snapshot",
      url: page.url(),
      title: await page.title(),
      snapshot: formatted,
      format: "a11y-tree",
    };
  } catch (err) {
    return { error: `Snapshot failed: ${err.message}` };
  }
}

/**
 * Format an accessibility tree node into a readable indented text representation.
 * Fallback for when locator.ariaSnapshot() is unavailable.
 */
function formatAccessibilityTree(node, depth) {
  if (!node) return "";
  const indent = "  ".repeat(depth);
  const parts = [];

  // Role
  let line = `${indent}- ${node.role}`;

  // Name (accessible name)
  if (node.name) line += ` "${node.name}"`;

  // Key attributes
  const attrs = [];
  if (node.level != null) attrs.push(`level=${node.level}`);
  if (node.checked != null) attrs.push(`checked=${node.checked}`);
  if (node.disabled) attrs.push("disabled");
  if (node.expanded != null) attrs.push(`expanded=${node.expanded}`);
  if (node.pressed != null) attrs.push(`pressed=${node.pressed}`);
  if (node.selected != null) attrs.push(`selected=${node.selected}`);
  if (node.required) attrs.push("required");
  if (node.valuetext) attrs.push(`value="${node.valuetext}"`);
  if (node.value != null && !node.valuetext) attrs.push(`value="${node.value}"`);
  if (attrs.length) line += ` [${attrs.join("][")}]`;

  parts.push(line);

  // Recurse children
  if (node.children) {
    for (const child of node.children) {
      parts.push(formatAccessibilityTree(child, depth + 1));
    }
  }

  return parts.filter(Boolean).join("\n");
}

// ────────────────────────────────────────────────────────────
// Ref-Based Interaction Actions
// ────────────────────────────────────────────────────────────
// These use ARIA role + name locators from snapshot output
// to interact with elements without CSS selectors.

/**
 * Resolve a ref string from an aria snapshot to a Playwright locator.
 *
 * Supports two modes:
 * 1. If ariaSnapshot gave us [ref=X] IDs (Playwright ≥1.49), use getByRole/getByLabel
 * 2. Direct role + name matching: "button:Submit", "link:Home", "textbox:Search"
 */
function resolveRef(page, ref) {
  // Format: "role:name" (e.g. "button:Submit", "link:Get started")
  const colonIdx = ref.indexOf(":");
  if (colonIdx > 0) {
    const role = ref.slice(0, colonIdx).trim();
    const name = ref.slice(colonIdx + 1).trim();
    return page.getByRole(role, { name, exact: false });
  }

  // Fallback: try as aria-label
  return page.getByLabel(ref, { exact: false });
}

async function actionClickRef(page, { ref }) {
  if (!ref) return { error: "Missing required parameter: ref" };

  try {
    const locator = resolveRef(page, ref);
    await locator.click({ timeout: 10_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});

    return {
      action: "click_ref",
      ref,
      url: page.url(),
      title: await page.title(),
    };
  } catch (err) {
    return { error: `click_ref failed for "${ref}": ${err.message}` };
  }
}

async function actionTypeRef(page, { ref, text, pressEnter }) {
  if (!ref) return { error: "Missing required parameter: ref" };
  if (text === undefined || text === null) return { error: "Missing required parameter: text" };

  try {
    const locator = resolveRef(page, ref);
    await locator.fill("", { timeout: 10_000 });
    await locator.fill(text, { timeout: 10_000 });

    if (pressEnter) {
      await locator.press("Enter");
      await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
    }

    return {
      action: "type_ref",
      ref,
      text,
      pressEnter: pressEnter || false,
      url: page.url(),
      title: await page.title(),
    };
  } catch (err) {
    return { error: `type_ref failed for "${ref}": ${err.message}` };
  }
}

async function actionHoverRef(page, { ref }) {
  if (!ref) return { error: "Missing required parameter: ref" };

  try {
    const locator = resolveRef(page, ref);
    await locator.hover({ timeout: 10_000 });

    return {
      action: "hover_ref",
      ref,
      url: page.url(),
    };
  } catch (err) {
    return { error: `hover_ref failed for "${ref}": ${err.message}` };
  }
}

async function actionSelectRef(page, { ref, value }) {
  if (!ref) return { error: "Missing required parameter: ref" };
  if (!value) return { error: "Missing required parameter: value" };

  try {
    const locator = resolveRef(page, ref);
    await locator.selectOption(value, { timeout: 10_000 });

    return {
      action: "select_ref",
      ref,
      value,
      url: page.url(),
      title: await page.title(),
    };
  } catch (err) {
    return { error: `select_ref failed for "${ref}": ${err.message}` };
  }
}

// ────────────────────────────────────────────────────────────
// Playwright Script Execution
// ────────────────────────────────────────────────────────────

const SCRIPT_TIMEOUT_MS = 60_000;
const MAX_SCRIPT_OUTPUT = 256 * 1024;

/**
 * Execute an arbitrary Playwright script in a subprocess.
 *
 * The script is written to a temp file and executed via `node`. It receives
 * the browser's WebSocket endpoint via the BROWSER_WS_ENDPOINT env var,
 * allowing it to connect to the existing singleton browser session.
 *
 * Scripts should use `chromium.connectOverCDP(process.env.BROWSER_WS_ENDPOINT)`
 * to connect.
 */
async function actionRunScript(_page, { script, timeout }) {
  if (!script) return { error: "Missing required parameter: script" };

  // Ensure the browser is running and get its WebSocket endpoint
  const b = await getBrowser();
  const wsEndpoint = b.wsEndpoint?.() || null;

  // Wrap the user script with boilerplate for connecting to our browser
  const wrappedScript = `
const { chromium } = require('playwright');

(async () => {
  const BROWSER_WS = process.env.BROWSER_WS_ENDPOINT;
  let browser;
  if (BROWSER_WS) {
    browser = await chromium.connectOverCDP(BROWSER_WS);
  } else {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  }
  const context = browser.contexts()[0] || await browser.newContext();
  const page = context.pages()[0] || await context.newPage();

  try {
    // ── User Script Start ──
    ${script}
    // ── User Script End ──
  } catch (err) {
    console.error('Script error:', err.message);
    process.exit(1);
  } finally {
    if (!BROWSER_WS) await browser.close();
  }
})();
`;

  let tmpDir;
  let scriptPath;

  try {
    // Write script to temp file
    tmpDir = await mkdtemp(join(tmpdir(), "pw-script-"));
    scriptPath = join(tmpDir, "script.cjs");
    await writeFile(scriptPath, wrappedScript, "utf-8");

    // Execute in subprocess
    const clampedTimeout = Math.min(Math.max(timeout || SCRIPT_TIMEOUT_MS, 5_000), 120_000);
    const result = await executeScript(scriptPath, wsEndpoint, clampedTimeout);

    return {
      action: "run_script",
      ...result,
    };
  } catch (err) {
    return { error: `run_script failed: ${err.message}` };
  } finally {
    // Cleanup
    if (scriptPath) {
      unlink(scriptPath).catch(() => {});
    }
    if (tmpDir) {
      import("node:fs").then(fs => fs.rmSync(tmpDir, { recursive: true, force: true })).catch(() => {});
    }
  }
}

/**
 * Execute a Playwright script file in a subprocess.
 */
function executeScript(scriptPath, wsEndpoint, timeoutMs) {
  return new Promise((resolve) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutLen = 0;
    let stderrLen = 0;
    let timedOut = false;
    let settled = false;

    const child = spawn("node", [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        BROWSER_WS_ENDPOINT: wsEndpoint || "",
        CI: "true",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      detached: false,
    });

    child.stdin.end();

    child.stdout.on("data", (chunk) => {
      if (stdoutLen < MAX_SCRIPT_OUTPUT) {
        stdoutChunks.push(chunk);
        stdoutLen += chunk.length;
      }
    });

    child.stderr.on("data", (chunk) => {
      if (stderrLen < MAX_SCRIPT_OUTPUT) {
        stderrChunks.push(chunk);
        stderrLen += chunk.length;
      }
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    function finish(exitCode) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");

      resolve({
        success: exitCode === 0 && !timedOut,
        stdout: stdoutLen > MAX_SCRIPT_OUTPUT ? stdout + "\n... [output truncated]" : stdout,
        stderr: stderrLen > MAX_SCRIPT_OUTPUT ? stderr + "\n... [output truncated]" : stderr,
        exitCode: timedOut ? null : exitCode,
        timedOut,
        ...(timedOut && { error: `Script timed out after ${timeoutMs}ms` }),
      });
    }

    child.on("close", (code) => finish(code));
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          success: false,
          stdout: "",
          stderr: "",
          exitCode: null,
          error: `Process error: ${err.message}`,
        });
      }
    });
  });
}

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

const ACTION_HANDLERS = {
  navigate: actionNavigate,
  screenshot: actionScreenshot,
  click: actionClick,
  type: actionType,
  scroll: actionScroll,
  evaluate: actionEvaluate,
  get_content: actionGetContent,
  get_elements: actionGetElements,
  wait: actionWait,
  snapshot: actionSnapshot,
  click_ref: actionClickRef,
  type_ref: actionTypeRef,
  hover_ref: actionHoverRef,
  select_ref: actionSelectRef,
  run_script: actionRunScript,
};

/**
 * Execute a browser action.
 *
 * @param {object} params
 * @param {string} params.action - Action name
 * @param {string} [params.sessionId] - Reuse a session (auto-generated if omitted)
 * @param {object} [params.*] - Action-specific parameters
 * @returns {Promise<object>} Result with action-specific fields + sessionId
 */
export async function agenticBrowserAction(params) {
  const { action, sessionId: requestedSessionId, ...actionParams } = params;

  // Handle close without needing a session
  if (action === "close") {
    const sid = requestedSessionId || "default";
    const closed = await closeSession(sid);
    return {
      action: "close",
      sessionId: sid,
      closed,
    };
  }

  const handler = ACTION_HANDLERS[action];
  if (!handler) {
    return {
      error: `Unknown action: "${action}". Valid actions: ${Object.keys(ACTION_HANDLERS).join(", ")}, close`,
    };
  }

  const sessionId = requestedSessionId || "default";

  try {
    const session = await getSession(sessionId);
    const result = await handler(session.page, actionParams);

    return {
      ...result,
      sessionId,
    };
  } catch (err) {
    return {
      error: `Browser action "${action}" failed: ${err.message}`,
      sessionId,
    };
  }
}

/**
 * Get browser service health info.
 */
export function getBrowserHealth() {
  return {
    browserConnected: browser?.isConnected() || false,
    activeSessions: sessions.size,
    maxSessions: MAX_SESSIONS,
  };
}

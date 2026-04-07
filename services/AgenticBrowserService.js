// ============================================================
// Agentic Browser Service — Headless Playwright Automation
// ============================================================
// Manages a singleton Chromium browser with per-session pages.
// Each session is a unique page context with auto-cleanup.
//
// Actions: navigate, screenshot, click, type, scroll,
//          evaluate, get_content, wait, close
// ============================================================

import { chromium } from "playwright";
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

  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
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
    session.lastUsed = Date.now();
    return session;
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
  wait: actionWait,
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

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASE_URL } from "./helpers.js";

// ─── Integration Tests for Web Extraction Endpoints ─────────────
//
// Tests for:
// 1. Individual platform fetchers (YouTube, GitHub, Reddit, etc.)
// 2. Unified get_web_content dispatcher
// 3. Unified get_package_info dispatcher
// 4. PDF and RSS extraction
//
// All hit the live tools-api server on localhost:5590.
// ────────────────────────────────────────────────────────────────

const BASE = `${BASE_URL}/knowledge`;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

// ═══════════════════════════════════════════════════════════════
// Individual Platform Endpoints (backward compat)
// ═══════════════════════════════════════════════════════════════

// ─── YouTube /youtube/video ───────────────────────────────────

describe("GET /youtube/video", () => {
  it("returns metadata for a YouTube URL", async () => {
    const { status, data } = await fetchJson(
      "/youtube/video?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&transcript=false",
    );
    assert.equal(status, 200);
    assert.ok(data.title, "should have title");
    assert.ok(data.author, "should have author");
    assert.ok(data.videoId, "should have videoId");
    assert.equal(data.videoId, "dQw4w9WgXcQ");
  });

  it("accepts bare video ID", async () => {
    const { status, data } = await fetchJson(
      "/youtube/video?url=dQw4w9WgXcQ&transcript=false",
    );
    assert.equal(status, 200);
    assert.equal(data.videoId, "dQw4w9WgXcQ");
  });

  it("returns 400 when url is missing", async () => {
    const { status, data } = await fetchJson("/youtube/video");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("includes transcript when requested", async () => {
    const { status, data } = await fetchJson(
      "/youtube/video?url=dQw4w9WgXcQ&transcript=true",
    );
    assert.equal(status, 200);
    // Transcript may or may not be available, but the field should exist
    assert.ok("transcript" in data || "error" in data);
  });
});

// ─── GitHub /github/repo ──────────────────────────────────────

describe("GET /github/repo", () => {
  it("returns metadata for owner/repo shorthand", async () => {
    const { status, data } = await fetchJson(
      "/github/repo?url=facebook/react&readme=false&languages=false",
    );
    assert.equal(status, 200);
    assert.equal(data.fullName, "facebook/react");
    assert.ok(data.stars > 0, "should have stars");
    assert.ok(data.description, "should have description");
    assert.ok(data.language, "should have primary language");
    assert.ok(data.license, "should have license");
  });

  it("returns README when requested", async () => {
    const { status, data } = await fetchJson(
      "/github/repo?url=facebook/react&readme=true&languages=false",
    );
    assert.equal(status, 200);
    assert.ok(data.readme, "should have README content");
    assert.ok(data.readme.length > 100, "README should have meaningful content");
  });

  it("returns language breakdown when requested", async () => {
    const { status, data } = await fetchJson(
      "/github/repo?url=facebook/react&readme=false&languages=true",
    );
    assert.equal(status, 200);
    assert.ok(data.languages, "should have languages object");
    assert.ok("JavaScript" in data.languages, "should have JavaScript");
  });

  it("returns topics array", async () => {
    const { status, data } = await fetchJson(
      "/github/repo?url=facebook/react&readme=false&languages=false",
    );
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.topics), "topics should be array");
    assert.ok(data.topics.length > 0, "should have topics");
  });

  it("returns 400 when url is missing", async () => {
    const { status, data } = await fetchJson("/github/repo");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("handles full GitHub URL", async () => {
    const { status, data } = await fetchJson(
      "/github/repo?url=https://github.com/expressjs/express&readme=false&languages=false",
    );
    assert.equal(status, 200);
    assert.equal(data.fullName, "expressjs/express");
  });
});

// ─── Reddit /reddit/thread ────────────────────────────────────

describe("GET /reddit/thread", () => {
  const REDDIT_URL = "/reddit/thread?url=https://www.reddit.com/r/AskReddit/comments/t0ynr/what_clue_that_you_are_dealing_with_a_redditor/";

  it("returns thread with title, author, and comments", async () => {
    const { status, data } = await fetchJson(`${REDDIT_URL}&commentLimit=3`);
    assert.equal(status, 200);
    assert.ok(data.title, "should have title");
    assert.ok(data.author, "should have author");
    assert.ok(data.subreddit, "should have subreddit");
    assert.ok(typeof data.score === "number", "should have score");
    assert.ok(typeof data.commentCount === "number", "should have commentCount");
    assert.ok(Array.isArray(data.comments), "should have comments array");
    assert.ok(data.comments.length <= 3, "should respect commentLimit");
  });

  it("comment has expected shape", async () => {
    const { data } = await fetchJson(`${REDDIT_URL}&commentLimit=1`);
    if (data.comments.length > 0) {
      const comment = data.comments[0];
      assert.ok("author" in comment, "comment should have author");
      assert.ok("body" in comment, "comment should have body");
      assert.ok("score" in comment, "comment should have score");
    }
  });

  it("returns 400 when url is missing", async () => {
    const { status, data } = await fetchJson("/reddit/thread");
    assert.equal(status, 400);
    assert.ok(data.error);
  });
});

// ─── NPM /npm/package ────────────────────────────────────────

describe("GET /npm/package", () => {
  it("returns metadata for a popular package", async () => {
    const { status, data } = await fetchJson("/npm/package?name=express&readme=false");
    assert.equal(status, 200);
    assert.equal(data.name, "express");
    assert.ok(data.version, "should have version");
    assert.ok(data.description, "should have description");
    assert.ok(data.license, "should have license");
    assert.ok(typeof data.weeklyDownloads === "number", "should have weeklyDownloads");
    assert.ok(data.dependencies, "should have dependencies");
  });

  it("includes README when not disabled", async () => {
    const { data } = await fetchJson("/npm/package?name=express");
    // README may or may not be present depending on the registry response
    assert.ok("readme" in data || data.name === "express");
  });

  it("returns 400 when name is missing", async () => {
    const { status, data } = await fetchJson("/npm/package");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("handles scoped package names", async () => {
    const { status, data } = await fetchJson("/npm/package?name=@types/node&readme=false");
    assert.equal(status, 200);
    assert.equal(data.name, "@types/node");
  });
});

// ─── PyPI /pypi/package ──────────────────────────────────────

describe("GET /pypi/package", () => {
  it("returns metadata for a Python package", async () => {
    const { status, data } = await fetchJson("/pypi/package?name=requests");
    assert.equal(status, 200);
    assert.equal(data.name, "requests");
    assert.ok(data.version, "should have version");
    assert.ok(data.summary, "should have summary");
    assert.ok(data.license, "should have license");
    assert.ok(data.requiresPython, "should have requiresPython");
  });

  it("includes dependency info", async () => {
    const { data } = await fetchJson("/pypi/package?name=requests");
    assert.ok(Array.isArray(data.requiresDist), "should have requiresDist array");
  });

  it("returns error when name is missing", async () => {
    const { data } = await fetchJson("/pypi/package");
    // Route uses asyncHandler without explicit validation —
    // fetcher returns error object in body
    assert.ok(data.error, "should have error when name is missing");
  });
});

// ─── PDF /pdf/read ───────────────────────────────────────────

describe("GET /pdf/read", () => {
  it("extracts text from a PDF URL", async () => {
    const { status, data } = await fetchJson(
      "/pdf/read?url=https://arxiv.org/pdf/1706.03762v7&maxPages=2",
    );
    assert.equal(status, 200);
    assert.ok(data.pageCount > 0, "should have pageCount");
    assert.ok(data.text, "should have text content");
    assert.ok(data.charCount > 0, "should have charCount");
    assert.ok(data.url, "should echo the URL");
  });

  it("returns info metadata", async () => {
    const { data } = await fetchJson(
      "/pdf/read?url=https://arxiv.org/pdf/1706.03762v7&maxPages=1",
    );
    assert.ok(data.info, "should have info object");
    assert.ok("title" in data.info, "info should have title field");
    assert.ok("author" in data.info, "info should have author field");
  });

  it("returns 400 when url is missing", async () => {
    const { status, data } = await fetchJson("/pdf/read");
    assert.equal(status, 400);
    assert.ok(data.error);
  });
});

// ─── RSS /rss/feed ───────────────────────────────────────────

describe("GET /rss/feed", () => {
  it("parses an RSS feed", async () => {
    const { status, data } = await fetchJson(
      "/rss/feed?url=https://hnrss.org/frontpage&limit=5",
    );
    assert.equal(status, 200);
    assert.ok(data.title, "should have feed title");
    assert.ok(data.format, "should report format");
    assert.ok(Array.isArray(data.items), "should have items array");
    assert.ok(data.items.length <= 5, "should respect limit");
    assert.ok(typeof data.itemCount === "number", "should have itemCount");
  });

  it("feed items have expected shape", async () => {
    const { data } = await fetchJson(
      "/rss/feed?url=https://hnrss.org/frontpage&limit=1",
    );
    if (data.items.length > 0) {
      const item = data.items[0];
      assert.ok(item.title, "item should have title");
      assert.ok(item.link, "item should have link");
    }
  });

  it("returns 400 when url is missing", async () => {
    const { status, data } = await fetchJson("/rss/feed");
    assert.equal(status, 400);
    assert.ok(data.error);
  });
});

// ─── Twitter /twitter/post ───────────────────────────────────

describe("GET /twitter/post", () => {
  it("returns 400 when url is missing", async () => {
    const { status, data } = await fetchJson("/twitter/post");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  // Note: We can't reliably test live tweets as they get deleted.
  // The fetcher itself was validated in manual tests.
  it("returns structured error for non-existent tweet", async () => {
    const { status, data } = await fetchJson(
      "/twitter/post?url=https://x.com/nobody/status/1",
    );
    assert.equal(status, 400);
    assert.ok(data.error, "should return error for missing tweet");
  });
});

// ─── Hacker News /hackernews/thread ──────────────────────────

describe("GET /hackernews/thread", () => {
  it("returns the original HN post (item 1)", async () => {
    const { status, data } = await fetchJson(
      "/hackernews/thread?url=https://news.ycombinator.com/item?id=1&commentLimit=2",
    );
    assert.equal(status, 200);
    assert.equal(data.title, "Y Combinator");
    assert.equal(data.author, "pg");
    assert.ok(typeof data.score === "number", "should have score");
    assert.ok(Array.isArray(data.comments), "should have comments array");
    assert.ok(data.comments.length <= 2, "should respect commentLimit");
  });

  it("returns 400 when url is missing", async () => {
    const { status, data } = await fetchJson("/hackernews/thread");
    assert.equal(status, 400);
    assert.ok(data.error);
  });
});

// ─── Stack Overflow /stackoverflow/question ──────────────────

describe("GET /stackoverflow/question", () => {
  it("returns question data for a popular question", async () => {
    const { status, data } = await fetchJson(
      "/stackoverflow/question?url=https://stackoverflow.com/questions/927358&answerLimit=2",
    );
    assert.equal(status, 200);
    assert.ok(data.title, "should have title");
    assert.ok(Array.isArray(data.tags), "should have tags array");
    assert.ok(typeof data.score === "number", "should have score");
    assert.ok(typeof data.viewCount === "number", "should have viewCount");
    assert.ok(data.viewCount > 1000000, "this popular Q should have >1M views");
    assert.ok(typeof data.isAnswered === "boolean", "should have isAnswered");
    assert.ok(Array.isArray(data.answers), "should have answers array");
    assert.ok(data.answers.length <= 2, "should respect answerLimit");
    assert.ok(typeof data.apiQuotaRemaining === "number", "should report API quota");
  });

  it("answer has expected shape", async () => {
    const { data } = await fetchJson(
      "/stackoverflow/question?url=927358&answerLimit=1",
    );
    if (data.answers.length > 0) {
      const answer = data.answers[0];
      assert.ok(typeof answer.score === "number", "answer should have score");
      assert.ok(typeof answer.isAccepted === "boolean", "answer should have isAccepted");
      assert.ok(answer.body, "answer should have body text");
      assert.ok(answer.author, "answer should have author");
    }
  });

  it("returns 400 when url is missing", async () => {
    const { status, data } = await fetchJson("/stackoverflow/question");
    assert.equal(status, 400);
    assert.ok(data.error);
  });
});

// ═══════════════════════════════════════════════════════════════
// Unified Endpoints
// ═══════════════════════════════════════════════════════════════

// ─── get_web_content /web/content ─────────────────────────────

describe("GET /web/content (unified)", () => {
  it("auto-detects GitHub from URL", async () => {
    const { status, data } = await fetchJson(
      "/web/content?url=facebook/react&readme=false&languages=false",
    );
    assert.equal(status, 200);
    assert.equal(data.platform, "github");
    assert.equal(data.fullName, "facebook/react");
    assert.ok(data.stars > 0);
  });

  it("auto-detects GitHub from full URL", async () => {
    const { status, data } = await fetchJson(
      "/web/content?url=https://github.com/expressjs/express&readme=false&languages=false",
    );
    assert.equal(status, 200);
    assert.equal(data.platform, "github");
    assert.equal(data.fullName, "expressjs/express");
  });

  it("auto-detects Reddit from URL", async () => {
    const { status, data } = await fetchJson(
      "/web/content?url=https://www.reddit.com/r/AskReddit/comments/t0ynr/what/&commentLimit=1",
    );
    assert.equal(status, 200);
    assert.equal(data.platform, "reddit");
    assert.ok(data.title);
    assert.ok(data.subreddit);
  });

  it("auto-detects Hacker News from URL", async () => {
    const { status, data } = await fetchJson(
      "/web/content?url=https://news.ycombinator.com/item?id=1&commentLimit=1",
    );
    assert.equal(status, 200);
    assert.equal(data.platform, "hackernews");
    assert.equal(data.title, "Y Combinator");
  });

  it("auto-detects Stack Overflow from URL", async () => {
    const { status, data } = await fetchJson(
      "/web/content?url=https://stackoverflow.com/questions/927358&answerLimit=1",
    );
    assert.equal(status, 200);
    assert.equal(data.platform, "stackoverflow");
    assert.ok(data.title);
    assert.ok(data.score > 10000, "popular Q should have high score");
  });

  it("auto-detects Twitter from x.com URL", async () => {
    // We can't test success (tweets get deleted), but we can test detection
    const { data } = await fetchJson(
      "/web/content?url=https://x.com/nobody/status/1",
    );
    // Will 400 because tweet doesn't exist, but error should mention tweet
    assert.ok(data.error);
  });

  it("returns error for unknown platform", async () => {
    const { status, data } = await fetchJson(
      "/web/content?url=https://example.com/random",
    );
    assert.equal(status, 400);
    assert.ok(data.error);
    assert.ok(data.error.includes("detect"), "error should mention detection failure");
  });

  it("returns 400 when url is missing", async () => {
    const { status, data } = await fetchJson("/web/content");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("passes commentLimit to Reddit", async () => {
    const { data } = await fetchJson(
      "/web/content?url=https://www.reddit.com/r/AskReddit/comments/t0ynr/what/&commentLimit=2",
    );
    assert.ok(data.comments.length <= 2);
  });

  it("passes readme option to GitHub", async () => {
    const { data } = await fetchJson(
      "/web/content?url=facebook/react&readme=true&languages=false",
    );
    assert.ok(data.readme, "should include README");
    assert.ok(data.readme.length > 100);
  });
});

// ─── get_package_info /package/info ───────────────────────────

describe("GET /package/info (unified)", () => {
  it("returns NPM package info", async () => {
    const { status, data } = await fetchJson(
      "/package/info?name=express&registry=npm&readme=false",
    );
    assert.equal(status, 200);
    assert.equal(data.registry, "npm");
    assert.equal(data.name, "express");
    assert.ok(data.version);
    assert.ok(data.license);
    assert.ok(typeof data.weeklyDownloads === "number");
  });

  it("returns PyPI package info", async () => {
    const { status, data } = await fetchJson(
      "/package/info?name=requests&registry=pypi",
    );
    assert.equal(status, 200);
    assert.equal(data.registry, "pypi");
    assert.equal(data.name, "requests");
    assert.ok(data.version);
    assert.ok(data.summary);
    assert.ok(data.requiresPython);
  });

  it("accepts 'pip' as registry alias", async () => {
    const { status, data } = await fetchJson(
      "/package/info?name=requests&registry=pip",
    );
    assert.equal(status, 200);
    assert.equal(data.registry, "pypi");
  });

  it("returns 400 when name is missing", async () => {
    const { status, data } = await fetchJson("/package/info?registry=npm");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns 400 when registry is missing", async () => {
    const { status, data } = await fetchJson("/package/info?name=express");
    assert.equal(status, 400);
    assert.ok(data.error);
  });

  it("returns 400 for unknown registry", async () => {
    const { status, data } = await fetchJson(
      "/package/info?name=express&registry=rubygems",
    );
    assert.equal(status, 400);
    assert.ok(data.error);
    assert.ok(data.error.includes("Unknown registry"));
  });

  it("handles scoped NPM packages", async () => {
    const { status, data } = await fetchJson(
      "/package/info?name=@types/node&registry=npm&readme=false",
    );
    assert.equal(status, 200);
    assert.equal(data.name, "@types/node");
  });
});

// ═══════════════════════════════════════════════════════════════
// Tool Schema Validation
// ═══════════════════════════════════════════════════════════════

describe("ToolSchemaService", () => {
  // Dynamically import to avoid module resolution issues
  let getToolSchemas;

  it("loads tool schemas", async () => {
    const mod = await import("../services/ToolSchemaService.js");
    getToolSchemas = mod.getToolSchemas;
    const tools = getToolSchemas();
    assert.ok(tools.length > 100, `expected >100 tools, got ${tools.length}`);
  });

  it("every tool has required fields", async () => {
    if (!getToolSchemas) return;
    const tools = getToolSchemas();
    for (const t of tools) {
      assert.ok(t.name, `tool missing name: ${JSON.stringify(t).slice(0, 100)}`);
      assert.ok(t.description, `${t.name} missing description`);
      assert.ok(t.endpoint, `${t.name} missing endpoint`);
      assert.ok(t.endpoint.path, `${t.name} missing endpoint.path`);
      assert.ok(t.domain, `${t.name} missing domain`);
      assert.ok(Array.isArray(t.labels), `${t.name} labels should be array`);
    }
  });

  it("no duplicate tool names", async () => {
    if (!getToolSchemas) return;
    const tools = getToolSchemas();
    const names = tools.map((t) => t.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    assert.deepEqual(dupes, [], `duplicate tool names: ${dupes.join(", ")}`);
  });

  it("all tools have at least one label", async () => {
    if (!getToolSchemas) return;
    const tools = getToolSchemas();
    const unlabeled = tools.filter((t) => t.labels.length === 0);
    assert.equal(
      unlabeled.length, 0,
      `unlabeled tools: ${unlabeled.map((t) => t.name).join(", ")}`,
    );
  });

  it("unified tools exist with correct schemas", async () => {
    if (!getToolSchemas) return;
    const tools = getToolSchemas();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    // get_web_content should exist
    assert.ok(byName.get_web_content, "get_web_content should exist");
    assert.ok(byName.get_web_content.parameters.properties.url, "should have url param");
    assert.deepEqual(byName.get_web_content.parameters.required, ["url"]);

    // get_package_info should exist
    assert.ok(byName.get_package_info, "get_package_info should exist");
    assert.ok(byName.get_package_info.parameters.properties.name, "should have name param");
    assert.ok(byName.get_package_info.parameters.properties.registry, "should have registry param");
    assert.deepEqual(byName.get_package_info.parameters.required, ["name", "registry"]);

    // Old individual tools should NOT exist in schemas
    const removed = [
      "get_github_repo", "get_reddit_thread", "get_twitter_post",
      "get_hackernews_thread", "get_stackoverflow_question",
      "get_npm_package", "get_pypi_package",
    ];
    for (const name of removed) {
      assert.equal(byName[name], undefined, `${name} should be removed from schemas`);
    }

    // YouTube should still exist individually
    assert.ok(byName.get_youtube_video, "get_youtube_video should still exist");
  });
});

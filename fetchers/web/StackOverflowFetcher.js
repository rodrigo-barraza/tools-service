// ============================================================
// Stack Overflow Fetcher — Question + Answers
// ============================================================
// Uses the Stack Exchange API v2.3. No auth needed.
// Rate limit: 300 requests/day without a key, 10,000 with.
// Docs: https://api.stackexchange.com/docs
// ============================================================

const SE_API = "https://api.stackexchange.com/2.3";
const MAX_ANSWERS = 10;

// ─── URL Parsing ───────────────────────────────────────────────────

const SO_URL_REGEX =
  /(?:https?:\/\/)?(?:stackoverflow\.com|stackexchange\.com|[a-z]+\.stackexchange\.com)\/questions\/(\d+)/i;

/**
 * Extract question ID and site from a Stack Overflow URL or raw ID.
 * @param {string} input
 * @returns {{ questionId: string, site: string } | null}
 */
function parseStackOverflowInput(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();

  const match = trimmed.match(SO_URL_REGEX);
  if (match) {
    // Determine site from URL
    let site = "stackoverflow";
    if (trimmed.includes("stackexchange.com") && !trimmed.includes("stackoverflow")) {
      const siteMatch = trimmed.match(/(?:https?:\/\/)?([a-z]+)\.stackexchange\.com/);
      if (siteMatch) site = siteMatch[1];
    }
    return { questionId: match[1], site };
  }

  // Bare numeric ID (assume stackoverflow)
  if (/^\d+$/.test(trimmed)) {
    return { questionId: trimmed, site: "stackoverflow" };
  }

  return null;
}

// ─── HTML → Text ─────────────────────────────────────────────────

function htmlToText(html) {
  if (!html) return "";
  return html
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
      return "\n```\n" + decodeHtmlEntities(code) + "\n```\n";
    })
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => {
      return "`" + decodeHtmlEntities(code) + "`";
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Fetch a Stack Overflow question with accepted and top answers.
 * @param {string} input - Stack Overflow URL or question ID
 * @param {object} [options]
 * @param {number} [options.answerLimit=5]
 * @returns {Promise<object>}
 */
export async function getStackOverflowQuestion(input, options = {}) {
  const parsed = parseStackOverflowInput(input);
  if (!parsed) {
    return { error: `Invalid Stack Overflow URL or question ID: "${input}"` };
  }

  const { questionId, site } = parsed;
  const { answerLimit = 5 } = options;
  const clampedLimit = Math.min(answerLimit, MAX_ANSWERS);

  try {
    // Use the "withbody" filter to get full HTML body in one request
    const params = new URLSearchParams({
      site,
      order: "desc",
      sort: "votes",
      filter: "withbody",
    });

    // Fetch question and answers concurrently
    const [qRes, aRes] = await Promise.all([
      fetch(`${SE_API}/questions/${questionId}?${params}`),
      fetch(`${SE_API}/questions/${questionId}/answers?${params}&pagesize=${clampedLimit}`),
    ]);

    if (!qRes.ok || !aRes.ok) {
      const status = !qRes.ok ? qRes.status : aRes.status;
      if (status === 400) return { error: "Question not found" };
      return { error: `Stack Exchange API error: ${status}` };
    }

    const qData = await qRes.json();
    const aData = await aRes.json();

    const question = qData.items?.[0];
    if (!question) {
      return { error: `Question not found: ${questionId}` };
    }

    const result = {
      questionId: question.question_id,
      title: question.title || null,
      url: question.link || `https://stackoverflow.com/questions/${questionId}`,
      author: question.owner?.display_name || null,
      authorReputation: question.owner?.reputation || null,
      body: htmlToText(question.body),
      tags: question.tags || [],
      score: question.score || 0,
      viewCount: question.view_count || 0,
      answerCount: question.answer_count || 0,
      isAnswered: question.is_answered || false,
      acceptedAnswerId: question.accepted_answer_id || null,
      createdAt: question.creation_date
        ? new Date(question.creation_date * 1000).toISOString()
        : null,
      lastActivityAt: question.last_activity_date
        ? new Date(question.last_activity_date * 1000).toISOString()
        : null,
    };

    // Process answers
    result.answers = (aData.items || []).map((a) => ({
      answerId: a.answer_id,
      author: a.owner?.display_name || null,
      authorReputation: a.owner?.reputation || null,
      body: htmlToText(a.body),
      score: a.score || 0,
      isAccepted: a.is_accepted || false,
      createdAt: a.creation_date
        ? new Date(a.creation_date * 1000).toISOString()
        : null,
    }));

    // Sort: accepted answer first, then by score
    result.answers.sort((a, b) => {
      if (a.isAccepted !== b.isAccepted) return a.isAccepted ? -1 : 1;
      return b.score - a.score;
    });

    // API quota info
    if (qData.quota_remaining !== undefined) {
      result.apiQuotaRemaining = qData.quota_remaining;
    }

    return result;
  } catch (error) {
    return { error: `Stack Overflow fetch failed: ${error.message}` };
  }
}

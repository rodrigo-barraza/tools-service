import { AGENT_IDS, IDENTITY_HEADERS, MODEL_IDS } from "@rodrigo-barraza/utilities-library/taxonomy";
// ─── Cron + Remote Trigger System ───────────────────────────

import CONFIG from "../config.ts";
import logger from "../logger.ts";
import { errorMessage } from "../utilities.ts";
import { getTraceHeaders } from "@rodrigo-barraza/utilities-library/service";
import { prismServiceAuthHeaders } from "./PrismService.ts";

// ────────────────────────────────────────────────────────────
// Collection Setup — No-op since we proxy to prism-service
// ────────────────────────────────────────────────────────────

export async function setupAgenticScheduleCollection() {
  logger.info(
    `   ✅ Agentic schedules collection setup bypassed (authoritative scheduler is in prism-service)`,
  );
}

// ────────────────────────────────────────────────────────────
// Proxy Actions to Prism Service
// ────────────────────────────────────────────────────────────

function delayToCron(delayString: string): string | null {
  const match = delayString.trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === "m") {
    return `*/${value} * * * *`;
  } else if (unit === "h") {
    return `0 */${value} * * *`;
  } else if (unit === "d") {
    return `0 0 */${value} * *`;
  }
  return null;
}

function getPrismUrl() {
  return CONFIG.PRISM_SERVICE_URL || "http://localhost:7777";
}

/**
 * Create a new schedule. Proxy to prism-service /scheduled-tasks.
 */
interface ScheduleCreateData {
  project?: string;
  name?: string;
  schedule?: string;
  prompt?: string;
  type?: string;
  agent?: string;
  model?: string;
  provider?: string;
  scheduleType?: string;
  scheduleTime?: string;
  scheduleDay?: string;
  scheduleDate?: string;
  cronExpression?: string;
  enabledTools?: string[];
}

export async function agenticScheduleCreate(data: ScheduleCreateData, username?: string) {
  const {
    project,
    name,
    schedule,
    prompt,
    type = "once",
    agent,
    model,
    provider,
    scheduleType,
    scheduleTime,
    scheduleDay,
    scheduleDate,
    cronExpression,
    enabledTools,
  } = data;

  if (!project || typeof project !== "string") {
    return { error: "'project' is required (string)" };
  }
  if (!name || typeof name !== "string") {
    return { error: "'name' is required (string)" };
  }
  if (!prompt || typeof prompt !== "string") {
    return { error: "'prompt' is required (string)" };
  }

  // Determine the scheduled parameters
  let sType = scheduleType || type; // fallback
  let cronExpr: string | null | undefined = cronExpression;
  const sDate = scheduleDate;

  if (sType === "once" && !sDate && schedule && typeof schedule === "string") {
    // once with a relative delay (e.g. "5m") remains modeled as cron
    sType = "cron";
    cronExpr = delayToCron(schedule);
  }

  // Build body for prism-service
  const body = {
    name,
    prompt,
    agent: agent === AGENT_IDS.NONE ? null : agent || AGENT_IDS.CODING,
    provider: provider || "anthropic",
    model: model || MODEL_IDS.claudeSonnet,
    scheduleType: sType,
    scheduleTime,
    scheduleDay,
    scheduleDate: sDate,
    cronExpression: cronExpr,
    toolConfig: enabledTools ? { enabledTools } : undefined,
  };

  try {
    const schedulerResponse = await fetch(`${getPrismUrl()}/scheduled-tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getTraceHeaders(),
        [IDENTITY_HEADERS.project]: project,
        [IDENTITY_HEADERS.username]: username || "system",
        ...prismServiceAuthHeaders(),
      },
      body: JSON.stringify(body),
    });

    if (!schedulerResponse.ok) {
      const errorPayload = await schedulerResponse.json().catch(() => ({}));
      return {
        error:
          errorPayload.error ||
          `Prism returned HTTP ${schedulerResponse.status}`,
      };
    }

    const created = await schedulerResponse.json();
    return {
      success: true,
      schedule: created,
      message: `Cron Job '${name}' created successfully in Prism.`,
    };
  } catch (error: unknown) {
    return { error: `Failed to reach Prism Service: ${errorMessage(error)}` };
  }
}

/**
 * List schedules for a project. Proxy to prism-service /scheduled-tasks.
 */
export async function agenticScheduleList(
  project: string,
  _options?: Record<string, unknown>,
  username?: string,
) {
  if (!project || typeof project !== "string") {
    return { error: "'project' is required (string)" };
  }

  try {
    const schedulerResponse = await fetch(`${getPrismUrl()}/scheduled-tasks`, {
      method: "GET",
      headers: {
        ...getTraceHeaders(),
        [IDENTITY_HEADERS.project]: project,
        [IDENTITY_HEADERS.username]: username || "system",
        ...prismServiceAuthHeaders(),
      },
    });

    if (!schedulerResponse.ok) {
      const errorPayload = await schedulerResponse.json().catch(() => ({}));
      return {
        error:
          errorPayload.error ||
          `Prism returned HTTP ${schedulerResponse.status}`,
      };
    }

    const tasks = await schedulerResponse.json();
    return {
      project,
      schedules: tasks,
      total: tasks.length,
    };
  } catch (error: unknown) {
    return { error: `Failed to reach Prism Service: ${errorMessage(error)}` };
  }
}

/**
 * Delete a schedule. Proxy to prism-service /scheduled-tasks/:id.
 */
export async function agenticScheduleDelete(
  project: string,
  scheduleId: string | number,
  username?: string,
) {
  if (!project || typeof project !== "string") {
    return { error: "'project' is required (string)" };
  }
  if (!scheduleId) {
    return { error: "'scheduleId' is required" };
  }

  try {
    const schedulerResponse = await fetch(
      `${getPrismUrl()}/scheduled-tasks/${scheduleId}`,
      {
        method: "DELETE",
        headers: {
          ...getTraceHeaders(),
          [IDENTITY_HEADERS.project]: project,
          [IDENTITY_HEADERS.username]: username || "system",
          ...prismServiceAuthHeaders(),
        },
      },
    );

    if (!schedulerResponse.ok) {
      const errorPayload = await schedulerResponse.json().catch(() => ({}));
      return {
        error:
          errorPayload.error ||
          `Prism returned HTTP ${schedulerResponse.status}`,
      };
    }

    const deleted = await schedulerResponse.json();
    return {
      deleted: deleted.success,
      scheduleId,
      message: `Cron Job '${scheduleId}' deleted successfully.`,
    };
  } catch (error: unknown) {
    return { error: `Failed to reach Prism Service: ${errorMessage(error)}` };
  }
}

/**
 * Fire a named remote trigger. Proxy to prism-service /scheduled-tasks/:id/trigger.
 */
export async function agenticTriggerFire(
  project: string,
  triggerName: string,
  payload: Record<string, unknown> = {},
  username?: string,
) {
  if (!project || typeof project !== "string") {
    return { error: "'project' is required (string)" };
  }
  if (!triggerName || typeof triggerName !== "string") {
    return { error: "'triggerName' is required (string)" };
  }

  try {
    const schedulerResponse = await fetch(
      `${getPrismUrl()}/scheduled-tasks/${encodeURIComponent(triggerName)}/trigger`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getTraceHeaders(),
          [IDENTITY_HEADERS.project]: project,
          [IDENTITY_HEADERS.username]: username || "system",
          ...prismServiceAuthHeaders(),
        },
        body: JSON.stringify({ payload }),
      },
    );

    if (!schedulerResponse.ok) {
      const errorPayload = await schedulerResponse.json().catch(() => ({}));
      return {
        error:
          errorPayload.error ||
          `Prism returned HTTP ${schedulerResponse.status}`,
      };
    }

    const result = await schedulerResponse.json();
    return {
      fired: true,
      trigger: triggerName,
      message: `Cron Job/Trigger '${triggerName}' fired successfully.`,
      result,
    };
  } catch (error: unknown) {
    return { error: `Failed to reach Prism Service: ${errorMessage(error)}` };
  }
}

// ────────────────────────────────────────────────────────────
// Poller — No-op since poller is natively handled by prism-service
// ────────────────────────────────────────────────────────────

export function startSchedulePoller() {
  logger.info(
    "   ⏰ Local schedule poller bypassed (authoritative scheduler poller is running in prism-service)",
  );
}

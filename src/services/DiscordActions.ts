import { DiscordRefusal } from "./DiscordScopeService.ts";

// ═══════════════════════════════════════════════════════════════
//  Discord Actions — argument checks for Lupos's action tools
//
//  create_discord_poll, create_discord_thread, the reminder tools and
//  set_discord_nickname forward to lupos-bot, which enforces every
//  rule again (permissions, rate limits, content filter). Checking the
//  arguments here first turns a bad call into a 400 the model can fix,
//  without a round-trip. The model never supplies guild or channel —
//  those come from the conversation (DiscordScopeService).
// ═══════════════════════════════════════════════════════════════

/** The caps the tool descriptions advertise — lupos-bot enforces the same. */
export const DISCORD_ACTION_LIMITS = {
  pollQuestionMaxCharacters: 300,
  pollAnswersMin: 2,
  pollAnswersMax: 10,
  pollAnswerMaxCharacters: 55,
  pollDurationHoursMin: 1,
  pollDurationHoursMax: 168,
  pollDurationHoursDefault: 24,
  threadNameMaxCharacters: 100,
  threadAutoArchiveMinutes: [60, 1440, 4320, 10080],
  threadAutoArchiveMinutesDefault: 1440,
  reminderTextMaxCharacters: 300,
  reminderDelayMinutesMin: 1,
  reminderDelayMinutesMax: 43_200,
  reminderLeadMinMs: 60_000,
  reminderLeadMaxMs: 30 * 24 * 60 * 60_000,
  reminderIdMaxCharacters: 100,
  nicknameMaxCharacters: 32,
} as const;

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

// ISO 8601 date-time WITH an offset: a bare local time would be read in
// whatever timezone parses it, and tools-service and lupos-bot need not
// agree on one.
const ISO_DATE_TIME_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

type Arguments = Record<string, unknown>;

function invalid(message: string) {
  return new DiscordRefusal(400, message);
}

/** Characters as Discord counts them (code points, not UTF-16 units). */
function characterCount(text: string) {
  return Array.from(text).length;
}

function boundedText(value: unknown, name: string, maxCharacters: number): string {
  if (typeof value !== "string") throw invalid(`${name} must be text.`);
  const text = value.trim();
  const count = characterCount(text);
  if (count > maxCharacters) {
    throw invalid(`${name} must be at most ${maxCharacters} characters (got ${count}).`);
  }
  return text;
}

function requiredText(value: unknown, name: string, maxCharacters: number): string {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
    throw invalid(`${name} is required.`);
  }
  return boundedText(value, name, maxCharacters);
}

function optionalNumber(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(number)) throw invalid(`${name} must be a number.`);
  return number;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw invalid(`${name} must be true or false.`);
}

export interface PollArguments {
  question: string;
  answers: string[];
  durationHours: number;
  allowMultiselect: boolean;
}

export function parsePollArguments(body: Arguments): PollArguments {
  const limits = DISCORD_ACTION_LIMITS;
  const question = requiredText(body.question, "question", limits.pollQuestionMaxCharacters);
  if (!Array.isArray(body.answers)) {
    throw invalid(
      `answers must be a list of ${limits.pollAnswersMin}-${limits.pollAnswersMax} answers.`,
    );
  }
  const answers = body.answers.map((answer, index) =>
    requiredText(answer, `answers[${index}]`, limits.pollAnswerMaxCharacters),
  );
  if (answers.length < limits.pollAnswersMin || answers.length > limits.pollAnswersMax) {
    throw invalid(
      `A poll needs ${limits.pollAnswersMin}-${limits.pollAnswersMax} answers (got ${answers.length}).`,
    );
  }
  const durationHours =
    optionalNumber(body.durationHours, "durationHours") ?? limits.pollDurationHoursDefault;
  if (
    !Number.isInteger(durationHours) ||
    durationHours < limits.pollDurationHoursMin ||
    durationHours > limits.pollDurationHoursMax
  ) {
    throw invalid(
      `durationHours must be a whole number of hours from ${limits.pollDurationHoursMin} to ${limits.pollDurationHoursMax}.`,
    );
  }
  const allowMultiselect = optionalBoolean(body.allowMultiselect, "allowMultiselect") ?? false;
  return { question, answers, durationHours, allowMultiselect };
}

export interface ThreadArguments {
  name: string;
  messageId?: string;
  autoArchiveMinutes: number;
}

export function parseThreadArguments(body: Arguments): ThreadArguments {
  const limits = DISCORD_ACTION_LIMITS;
  const name = requiredText(body.name, "name", limits.threadNameMaxCharacters);
  let messageId: string | undefined;
  if (body.messageId !== undefined && body.messageId !== null && body.messageId !== "") {
    messageId = String(body.messageId).trim();
    if (!SNOWFLAKE_PATTERN.test(messageId)) {
      throw invalid("messageId must be a Discord message ID (17-20 digits).");
    }
  }
  const autoArchiveMinutes =
    optionalNumber(body.autoArchiveMinutes, "autoArchiveMinutes") ??
    limits.threadAutoArchiveMinutesDefault;
  if (!(limits.threadAutoArchiveMinutes as readonly number[]).includes(autoArchiveMinutes)) {
    throw invalid(
      `autoArchiveMinutes must be one of ${limits.threadAutoArchiveMinutes.join(", ")}.`,
    );
  }
  return { name, ...(messageId && { messageId }), autoArchiveMinutes };
}

export type ReminderArguments =
  | { text: string; delayMinutes: number }
  | { text: string; dueAt: string };

/**
 * `dueAt` goes to lupos-bot normalised to UTC (`toISOString`), so both
 * services read the same instant.
 */
export function parseReminderArguments(body: Arguments, now = Date.now()): ReminderArguments {
  const limits = DISCORD_ACTION_LIMITS;
  const text = requiredText(body.text, "text", limits.reminderTextMaxCharacters);
  const delayMinutes = optionalNumber(body.delayMinutes, "delayMinutes");
  const hasDueAt = body.dueAt !== undefined && body.dueAt !== null && body.dueAt !== "";
  if (delayMinutes !== undefined && hasDueAt) {
    throw invalid("Give delayMinutes or dueAt, not both.");
  }
  if (delayMinutes !== undefined) {
    if (
      delayMinutes < limits.reminderDelayMinutesMin ||
      delayMinutes > limits.reminderDelayMinutesMax
    ) {
      throw invalid(
        `delayMinutes must be from ${limits.reminderDelayMinutesMin} to ${limits.reminderDelayMinutesMax} (30 days).`,
      );
    }
    return { text, delayMinutes };
  }
  if (!hasDueAt) {
    throw invalid(
      "Give delayMinutes (1-43200) or dueAt (an ISO 8601 time with a timezone, 1 minute to 30 days ahead).",
    );
  }
  const dueAtText = typeof body.dueAt === "string" ? body.dueAt.trim() : "";
  const dueAtMs = ISO_DATE_TIME_WITH_OFFSET.test(dueAtText) ? Date.parse(dueAtText) : NaN;
  if (!Number.isFinite(dueAtMs)) {
    throw invalid(
      "dueAt must be an ISO 8601 time with a timezone offset, e.g. 2026-09-23T17:00:00-07:00.",
    );
  }
  const lead = dueAtMs - now;
  if (lead < limits.reminderLeadMinMs || lead > limits.reminderLeadMaxMs) {
    throw invalid("dueAt must be from 1 minute to 30 days from now.");
  }
  return { text, dueAt: new Date(dueAtMs).toISOString() };
}

export function parseReminderCancelArguments(body: Arguments): { reminderId: string } {
  return {
    reminderId: requiredText(
      body.reminderId,
      "reminderId",
      DISCORD_ACTION_LIMITS.reminderIdMaxCharacters,
    ),
  };
}

/** An empty nickname is meaningful: it resets Lupos's nickname. */
export function parseNicknameArguments(body: Arguments): { nickname: string } {
  if (body.nickname === undefined || body.nickname === null) {
    throw invalid("nickname is required — an empty string resets it.");
  }
  return {
    nickname: boundedText(body.nickname, "nickname", DISCORD_ACTION_LIMITS.nicknameMaxCharacters),
  };
}

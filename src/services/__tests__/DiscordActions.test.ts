import { describe, it, expect } from "vitest";
import {
  parseNicknameArguments,
  parsePollArguments,
  parseReminderArguments,
  parseReminderCancelArguments,
  parseThreadArguments,
} from "../DiscordActions.ts";
import { DiscordRefusal } from "../DiscordScopeService.ts";

// ═══════════════════════════════════════════════════════════════
// DiscordActions — argument checks for the Discord action tools
//
// Every cap the tool descriptions advertise, at its boundary. A bad
// call is a 400 the model can fix; lupos-bot re-checks everything.
// ═══════════════════════════════════════════════════════════════

/** The 400 message `run` refuses with (fails the test if it does not). */
function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DiscordRefusal);
    expect((error as DiscordRefusal).status).toBe(400);
    return String((error as DiscordRefusal).body.error);
  }
  throw new Error("expected a refusal");
}

const text = (length: number) => "x".repeat(length);

describe("parsePollArguments", () => {
  const answers = ["yes", "no"];

  it("applies the defaults (24 h, single choice) and trims", () => {
    expect(parsePollArguments({ question: "  Pizza?  ", answers: [" yes ", "no"] })).toEqual({
      question: "Pizza?",
      answers: ["yes", "no"],
      durationHours: 24,
      allowMultiselect: false,
    });
  });

  it("keeps given duration and multiselect", () => {
    expect(
      parsePollArguments({ question: "q", answers, durationHours: 168, allowMultiselect: true }),
    ).toMatchObject({ durationHours: 168, allowMultiselect: true });
    expect(
      parsePollArguments({ question: "q", answers, durationHours: "1", allowMultiselect: "false" }),
    ).toMatchObject({ durationHours: 1, allowMultiselect: false });
  });

  it("caps the question at 300 characters", () => {
    expect(parsePollArguments({ question: text(300), answers }).question).toHaveLength(300);
    expect(refusal(() => parsePollArguments({ question: text(301), answers }))).toContain("300");
    expect(refusal(() => parsePollArguments({ answers }))).toContain("question is required");
  });

  it("counts characters as Discord does, not UTF-16 units", () => {
    // 300 emoji are 600 UTF-16 units but 300 characters.
    expect(() => parsePollArguments({ question: "🐺".repeat(300), answers })).not.toThrow();
  });

  it("takes 2-10 answers of at most 55 characters", () => {
    const ten = Array.from({ length: 10 }, (_, index) => `answer ${index}`);
    expect(parsePollArguments({ question: "q", answers: ten }).answers).toHaveLength(10);
    expect(refusal(() => parsePollArguments({ question: "q", answers: ["only"] }))).toContain("2-10");
    expect(refusal(() => parsePollArguments({ question: "q", answers: [...ten, "11"] }))).toContain(
      "2-10",
    );
    expect(refusal(() => parsePollArguments({ question: "q", answers: "yes, no" }))).toContain(
      "list",
    );
    expect(parsePollArguments({ question: "q", answers: [text(55), "b"] }).answers[0]).toHaveLength(55);
    expect(refusal(() => parsePollArguments({ question: "q", answers: [text(56), "b"] }))).toContain(
      "answers[0]",
    );
    expect(refusal(() => parsePollArguments({ question: "q", answers: ["a", " "] }))).toContain(
      "answers[1] is required",
    );
  });

  it("runs 1-168 whole hours", () => {
    for (const durationHours of [0, 169, 1.5, "soon"]) {
      expect(refusal(() => parsePollArguments({ question: "q", answers, durationHours }))).toMatch(
        /durationHours/,
      );
    }
  });

  it("wants a real boolean for allowMultiselect", () => {
    expect(
      refusal(() => parsePollArguments({ question: "q", answers, allowMultiselect: "maybe" })),
    ).toContain("allowMultiselect");
  });
});

describe("parseThreadArguments", () => {
  it("defaults to a 1440-minute auto-archive, no source message", () => {
    expect(parseThreadArguments({ name: " Raid night " })).toEqual({
      name: "Raid night",
      autoArchiveMinutes: 1440,
    });
  });

  it("keeps a source message and an allowed auto-archive", () => {
    for (const autoArchiveMinutes of [60, 1440, 4320, 10080]) {
      expect(
        parseThreadArguments({
          name: "n",
          messageId: "1526820952019701853",
          autoArchiveMinutes,
        }),
      ).toEqual({ name: "n", messageId: "1526820952019701853", autoArchiveMinutes });
    }
  });

  it("refuses a long name, a bad message ID and an unsupported auto-archive", () => {
    expect(parseThreadArguments({ name: text(100) }).name).toHaveLength(100);
    expect(refusal(() => parseThreadArguments({ name: text(101) }))).toContain("100");
    expect(refusal(() => parseThreadArguments({}))).toContain("name is required");
    expect(refusal(() => parseThreadArguments({ name: "n", messageId: "abc" }))).toContain(
      "messageId",
    );
    expect(refusal(() => parseThreadArguments({ name: "n", autoArchiveMinutes: 30 }))).toContain(
      "60, 1440, 4320, 10080",
    );
  });
});

describe("parseReminderArguments", () => {
  const NOW = Date.parse("2026-09-22T12:00:00Z");

  it("takes delayMinutes from 1 to 43200", () => {
    expect(parseReminderArguments({ text: " stretch ", delayMinutes: 1 }, NOW)).toEqual({
      text: "stretch",
      delayMinutes: 1,
    });
    expect(parseReminderArguments({ text: "t", delayMinutes: 43_200 }, NOW)).toEqual({
      text: "t",
      delayMinutes: 43_200,
    });
    expect(refusal(() => parseReminderArguments({ text: "t", delayMinutes: 0 }, NOW))).toContain(
      "43200",
    );
    expect(
      refusal(() => parseReminderArguments({ text: "t", delayMinutes: 43_201 }, NOW)),
    ).toContain("43200");
  });

  it("normalises dueAt to UTC and holds it 1 minute to 30 days ahead", () => {
    expect(
      parseReminderArguments({ text: "t", dueAt: "2026-09-22T05:30:00-07:00" }, NOW),
    ).toEqual({ text: "t", dueAt: "2026-09-22T12:30:00.000Z" });
    expect(parseReminderArguments({ text: "t", dueAt: "2026-09-22T12:01:00Z" }, NOW)).toEqual({
      text: "t",
      dueAt: "2026-09-22T12:01:00.000Z",
    });
    expect(parseReminderArguments({ text: "t", dueAt: "2026-10-22T12:00:00Z" }, NOW)).toEqual({
      text: "t",
      dueAt: "2026-10-22T12:00:00.000Z",
    });
    expect(
      refusal(() => parseReminderArguments({ text: "t", dueAt: "2026-09-22T12:00:30Z" }, NOW)),
    ).toContain("1 minute to 30 days");
    expect(
      refusal(() => parseReminderArguments({ text: "t", dueAt: "2026-10-22T12:01:00Z" }, NOW)),
    ).toContain("1 minute to 30 days");
  });

  it("refuses a dueAt without a timezone, or not a time at all", () => {
    expect(
      refusal(() => parseReminderArguments({ text: "t", dueAt: "2026-09-23T17:00:00" }, NOW)),
    ).toContain("timezone");
    expect(refusal(() => parseReminderArguments({ text: "t", dueAt: "tomorrow" }, NOW))).toContain(
      "timezone",
    );
  });

  it("wants exactly one of delayMinutes and dueAt", () => {
    expect(
      refusal(() =>
        parseReminderArguments({ text: "t", delayMinutes: 5, dueAt: "2026-09-23T00:00:00Z" }, NOW),
      ),
    ).toContain("not both");
    expect(refusal(() => parseReminderArguments({ text: "t" }, NOW))).toContain("delayMinutes");
  });

  it("caps the text at 300 characters", () => {
    expect(
      refusal(() => parseReminderArguments({ text: text(301), delayMinutes: 5 }, NOW)),
    ).toContain("300");
    expect(refusal(() => parseReminderArguments({ delayMinutes: 5 }, NOW))).toContain(
      "text is required",
    );
  });
});

describe("parseReminderCancelArguments", () => {
  it("takes the reminder ID", () => {
    expect(parseReminderCancelArguments({ reminderId: " 66f0c0ffee " })).toEqual({
      reminderId: "66f0c0ffee",
    });
    expect(refusal(() => parseReminderCancelArguments({}))).toContain("reminderId is required");
  });
});

describe("parseNicknameArguments", () => {
  it("takes up to 32 characters, and an empty string as a reset", () => {
    expect(parseNicknameArguments({ nickname: " Lupos the Wise " })).toEqual({
      nickname: "Lupos the Wise",
    });
    expect(parseNicknameArguments({ nickname: text(32) }).nickname).toHaveLength(32);
    expect(parseNicknameArguments({ nickname: "" })).toEqual({ nickname: "" });
  });

  it("refuses a missing or too-long nickname", () => {
    expect(refusal(() => parseNicknameArguments({}))).toContain("empty string resets");
    expect(refusal(() => parseNicknameArguments({ nickname: text(33) }))).toContain("32");
    expect(refusal(() => parseNicknameArguments({ nickname: 42 }))).toContain("text");
  });
});

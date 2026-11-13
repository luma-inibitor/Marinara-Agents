import assert from "node:assert/strict";
import { slurpContinuityInstruction } from "../packages/slurp2/src/engine/packages/server/src/slp/modules/continuity/slp-continuity-prompt.ts";

type Event = NonNullable<Parameters<typeof slurpContinuityInstruction>[0]["events"]>[number];
const event = (index: number, eventType: string, payload: Record<string, unknown> = {}) =>
  ({
    id: `e${index}`,
    eventType,
    source: "slurp_post",
    realityScope: "slurp",
    audienceScope: "creator_private",
    threadId: null,
    payload,
    status: "active",
    confidence: 1,
    evidence: "",
    relatedIds: [],
    fingerprint: `f${index}`,
    contribution: "system",
    occurredAt: "",
    createdAt: "",
    expiresAt: null,
    sourceKind: "character",
    sourceEntityId: "c1",
    creatorAccountId: "a1",
  }) as unknown as Event;

const recently = (text: string) =>
  text
    .split("Recently:\n")[1]!
    .split("\n")
    .filter((row) => row.startsWith("- "));

// Quiet slots are one summary line, and real activity fills the other slots. "Did not post." took
// six to eight of the eight lines for most Creators.
const events = [
  ...Array.from({ length: 6 }, (_, index) => event(index, "chosen_skip", { reason: "quiet_day" })),
  ...Array.from({ length: 10 }, (_, index) => event(10 + index, "post_published", { summary: `Post ${index}` })),
];
const lines = recently(slurpContinuityInstruction({ facts: [], events }));
assert.equal(lines.length, 8, "the list stays at eight lines");
assert.equal(lines.filter((row) => /Did not post/u.test(row)).length, 1, "one line for all quiet slots");
assert.equal(lines.at(-1), "- Did not post 6 times lately.");
assert.equal(lines.filter((row) => /^- Posted: Post \d\./u.test(row)).length, 7, "seven real events");
assert.equal(lines[0], "- Posted: Post 0.", "newest activity first");

// One quiet slot reads as once; only quiet slots still make a block.
assert.deepEqual(recently(slurpContinuityInstruction({ facts: [], events: [event(1, "chosen_skip")] })), [
  "- Did not post once lately.",
]);
// No quiet slots: no summary, and the full eight slots are activity.
const busy = recently(slurpContinuityInstruction({ facts: [], events: events.slice(6) }));
assert.equal(busy.length, 8);
assert.ok(busy.every((row) => !/Did not post/u.test(row)));
assert.equal(slurpContinuityInstruction({ facts: [], events: [] }), "");

console.log("slurp2 quiet days regression checks passed");

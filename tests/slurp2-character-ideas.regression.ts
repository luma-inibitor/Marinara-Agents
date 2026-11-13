import assert from "node:assert/strict";
import {
  runSlurpPostIdeation,
  slurpApplyPostIdea,
  slurpAutomaticPostFree,
  slurpIdeationPlans,
  slurpIdeationSkip,
  type SlurpIdeationInput,
  type SlurpIdeationMessage,
} from "../packages/slurp2/src/engine/packages/server/src/slp/modules/feed/slp-post-ideation.ts";
import { buildSlurpIdeationPrompt } from "../packages/slurp2/src/engine/packages/server/src/slp/modules/feed/slp-post-ideation-prompt.ts";
import { slurpCheckPostIdea } from "../packages/slurp2/src/engine/packages/server/src/slp/modules/feed/slp-post-ideation-parse.ts";
import {
  slurpPostVariation,
  slurpTeaserPost,
} from "../packages/slurp2/src/engine/packages/server/src/slp/modules/feed/slp-post-variation.ts";
import { SLURP_IDEATION_SETTINGS_DEFAULTS } from "../packages/slurp2/src/engine/packages/server/src/slp/modules/settings/slp-settings-ideation.ts";
import { slurp2Source } from "./slurp2-source";

// Character-led post ideas: one model call lets the Creator choose what an automatic post is about.
// Code keeps access, the heat ceiling, the cast and cameras, and every directed post, and checks the answer.

const AT = new Date("2026-11-12T12:00:00Z");
const DAY = 86_400_000;
const interests = "He tends three bonsai, plays Chopin badly, and collects first editions of Mann.";
const filler = Array.from({ length: 400 }, (_, index) => `Paragraph ${index} of a very long backstory.`).join("\n\n");

function input(overrides: Partial<SlurpIdeationInput> = {}): SlurpIdeationInput {
  return {
    name: "Dr. Veill",
    steeringIdea: null,
    card: {
      description: `${interests}\n\n{{user}} is his newest patient.\n\nA surgeon with a quiet clinic.`,
      personality: "Precise, dry, patient.",
      scenario: "",
      backstory: filler,
      examples: [],
    },
    profile: {
      bio: "Surgeon. Gardener.",
      voice: "Clinical and dry.",
      focus: "",
      push: [],
      avoid: [],
      turnOns: ["Endurance", "Praise"],
      hardNoes: ["Blood"],
      locations: "The clinic, his greenhouse.",
    },
    lore: "",
    day: { current: "At the clinic", previous: null },
    cast: [
      {
        id: "acct-ryan",
        name: "Ryan",
        kind: "rival",
        about: "A rival surgeon.",
        accountId: "acct-ryan",
        intimate: false,
      },
    ],
    recent: [
      { subject: "bonsai pruning", idea: "He prunes the juniper.", followsPlan: null },
      { subject: "night shift", idea: "A long night at the clinic.", followsPlan: null },
    ],
    plans: [],
    options: { beat: null, place: "the clinic", moment: "between patients", spice: null },
    limits: {
      access: "locked",
      teaser: false,
      ceiling: "none",
      cameras: ["selfie", "tripod"],
      suggestedCamera: "selfie",
      companyCanHoldCamera: false,
    },
    closet: { everyday: [], intimate: [] },
    at: AT,
    ...overrides,
  };
}

const answer = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    subject: "first editions",
    idea: "He shows a first edition of Buddenbrooks he found this week and reads the opening aloud.",
    offer: "The whole reading, and why this copy matters to him.",
    sources: ["collects first editions of Mann"],
    cast: [],
    place: "his study",
    moment: "turning the first page",
    outfit: "a grey cardigan",
    wardrobeId: null,
    camera: "tripod",
    heat: "none",
    followsPlan: null,
    tags: ["books"],
    ...fields,
  });

function stub(...answers: string[]) {
  const calls: SlurpIdeationMessage[][] = [];
  return {
    calls,
    complete: async (messages: SlurpIdeationMessage[]) => {
      calls.push(messages);
      return answers[Math.min(calls.length - 1, answers.length - 1)]!;
    },
  };
}

// 1. The prompt carries the card up to its cap, the player's idea first, and recent subjects, not titles.
{
  const prompt = buildSlurpIdeationPrompt(input({ steeringIdea: "Show the new greenhouse" }), {
    hooks: [],
    background: [],
  });
  assert.ok(prompt.user.startsWith("# Steering idea\nShow the new greenhouse"), "the steering idea comes first");
  assert.ok(prompt.user.includes(interests), "the card's interests reach the idea step");
  assert.ok(!prompt.user.includes("{{user}}"), "lines addressed to the player's persona are dropped");
  const card = /# Character card\n([\s\S]*?)\n\n# Stage profile/u.exec(prompt.user)?.[1] ?? "";
  assert.ok(card.length > 12_000 && card.length <= 16_020, `the card fills its ~4k-token cap (${card.length} chars)`);
  assert.ok(prompt.user.indexOf("# Character card") < prompt.user.indexOf("# Stage profile"), "card before profile");
  assert.match(prompt.user, /# Recent ideas[\s\S]*- bonsai pruning: He prunes the juniper\./u);
  assert.ok(prompt.system.length + prompt.user.length <= 8000 * 4, "the whole prompt stays under ~8k tokens");
  assert.equal(prompt.user.lastIndexOf("\n# "), prompt.user.indexOf("\n# Limits"), "limits come last, never cut");
}

// 2. A clean page says clean, and its locked post is extra access, never undressing.
{
  const prompt = buildSlurpIdeationPrompt(input(), { hooks: [], background: [] });
  assert.match(prompt.user, /This page is clean: nothing sexual, no undressing/u);
  assert.match(prompt.user, /a locked post is extra access, never undressing/u);
  assert.doesNotMatch(prompt.user, /Turn-ons/u, "a clean page's prompt carries no turn-ons");
  const strip = slurpCheckPostIdea(
    answer({ moment: "slowly takes off his shirt, down to his underwear" }),
    input(),
    [],
  );
  assert.equal(strip.idea, null, "an undressing idea on a clean page is rejected");
  const negated = slurpCheckPostIdea(
    answer({ idea: "A candid look at his study, no nudity, just books." }),
    input(),
    [],
  );
  assert.ok(negated.idea, "a negated mention is not undressing");
  const over = slurpCheckPostIdea(answer({ heat: "suggestive" }), input(), []);
  assert.ok(over.problems.some((problem) => /above the ceiling/u.test(problem)));
  const noOffer = slurpCheckPostIdea(answer({ offer: null }), input(), []);
  assert.ok(
    noOffer.problems.some((problem) => /offer is missing/u.test(problem)),
    "a locked idea says what it offers",
  );
}

// 3. A cast member outside the list: one retry, then today's planner (a null idea, recorded as fallback).
async function retries() {
  const bad = answer({ cast: ["acct-stranger"] });
  const model = stub(bad, bad);
  const result = await runSlurpPostIdeation(input(), model.complete);
  assert.equal(result.idea, null);
  assert.equal(result.record.status, "fallback");
  assert.equal(model.calls.length, 2, "exactly one retry");
  assert.match(model.calls[1]!.at(-1)!.content, /cast id acct-stranger is not in the list/u);
  assert.match(result.record.reason ?? "", /still invalid after one retry/u);

  const fixed = stub(bad, answer());
  const retried = await runSlurpPostIdeation(input(), fixed.complete);
  assert.equal(retried.record.status, "used");
  assert.equal(retried.idea?.subject, "first editions");

  const broken = stub("not json", "still not json");
  assert.equal((await runSlurpPostIdeation(input(), broken.complete)).idea, null, "invalid JSON falls back");
  const camera = stub(answer({ camera: "mirror" }), answer({ camera: "mirror" }));
  assert.equal(
    (await runSlurpPostIdeation(input(), camera.complete)).idea,
    null,
    "a camera outside the list falls back",
  );

  // The same subject as one of the last two posts earns one retry; the retry stands either way.
  const repeat = stub(answer({ subject: "bonsai" }), answer({ subject: "bonsai" }));
  const repeated = await runSlurpPostIdeation(input(), repeat.complete);
  assert.equal(repeat.calls.length, 2);
  assert.equal(repeated.idea?.subject, "bonsai");
  const thrown = await runSlurpPostIdeation(input(), async () => {
    throw new Error("connection busy");
  });
  assert.equal(thrown.record.status, "fallback");
  assert.match(thrown.record.reason ?? "", /connection busy/u);
}

// 4. The plan cap: 2 of the last 6 posts followed a plan, so plans are background only. Old plans are no hook.
{
  const plans = [
    { id: "plan-new", text: "Repot the juniper", createdAt: new Date(AT.getTime() - DAY).toISOString() },
    { id: "plan-old", text: "Open a second clinic", createdAt: new Date(AT.getTime() - 9 * DAY).toISOString() },
  ];
  const quiet = [{ subject: "a", idea: "", followsPlan: null }];
  const open = slurpIdeationPlans(plans, quiet, AT);
  assert.equal(open.mode, "hook");
  assert.deepEqual(
    open.hooks.map((plan) => plan.id),
    ["plan-new"],
    "a plan older than 7 days is never a hook",
  );
  assert.deepEqual(
    open.background.map((plan) => plan.id),
    ["plan-old"],
  );
  const busy = [
    { subject: "a", idea: "", followsPlan: "p1" },
    { subject: "b", idea: "", followsPlan: null },
    { subject: "c", idea: "", followsPlan: "p2" },
  ];
  const capped = slurpIdeationPlans(plans, busy, AT);
  assert.equal(capped.mode, "background");
  assert.equal(capped.hooks.length, 0);
  const prompt = buildSlurpIdeationPrompt(input({ plans, recent: busy }), capped);
  assert.match(prompt.user, /followsPlan: null\. Your plans are background this time/u);
  const sneaky = slurpCheckPostIdea(answer({ followsPlan: "plan-new" }), input(), capped.hooks);
  assert.ok(sneaky.problems.includes("followsPlan must be null this time"));
}

// 5. lockedShare holds over 100 seeded posts per Creator (within 10 points), teaser slots free first.
for (const share of [0.5, 0.3, 0.8]) {
  for (const creator of ["creator-a", "creator-b", "creator-c", "creator-d"]) {
    const settings = { teaserRate: "regular" as const, characterLedIdeas: true, lockedShare: share };
    const locked = Array.from({ length: 100 }, (_, sequence) => !slurpAutomaticPostFree(creator, sequence, settings));
    const count = locked.filter(Boolean).length;
    assert.ok(Math.abs(count - share * 100) <= 10, `${creator} at ${share}: ${count} of 100 locked`);
  }
}
for (let sequence = 0; sequence < 100; sequence += 1) {
  const teaser = slurpTeaserPost("creator-a", sequence, "regular");
  const free = slurpAutomaticPostFree("creator-a", sequence, {
    teaserRate: "regular",
    characterLedIdeas: true,
    lockedShare: 0.5,
  });
  if (teaser) assert.equal(free, true, "a teaser slot stays free while the free share covers the teaser rate");
}
assert.deepEqual(SLURP_IDEATION_SETTINGS_DEFAULTS, { characterLedIdeas: true, lockedShare: 0.5 }, "on by default");
const settingsSource = slurp2Source(
  "packages/slurp2/src/engine/packages/server/src/slp/modules/settings/slp-settings.ts",
);
assert.match(settingsSource, /\.\.\.slurpIdeationSettingsShape,/u);
assert.match(settingsSource, /\.\.\.SLURP_IDEATION_SETTINGS_DEFAULTS,/u);

// 6. Directed posts keep today's path and skip the idea step.
{
  const plain = {
    enabled: true,
    directed: false,
    hasVariation: true,
    project: false,
    shoot: false,
    reusedPicture: false,
    intent: "casual",
    purpose: null,
    teasedKind: null,
    beat: { anchorKind: "work", tie: undefined, trend: undefined, sharedId: undefined },
  };
  assert.equal(slurpIdeationSkip(plain), null, "an ordinary automatic post gets an idea");
  assert.equal(slurpIdeationSkip({ ...plain, beat: { ...plain.beat, anchorKind: "steer" } }), null);
  for (const directed of [
    { directed: true },
    { hasVariation: false },
    { project: true },
    { shoot: true },
    { reusedPicture: true },
    { intent: "request" },
    { purpose: { kind: "answer_fans" } },
    { purpose: { kind: "drop", teasePostId: "post-1" } },
    { beat: { ...plain.beat, tie: { kind: "collab" } } },
    { beat: { ...plain.beat, anchorKind: "sponsor" } },
    { beat: { ...plain.beat, sharedId: "poll:1" } },
  ] as const) {
    assert.ok(slurpIdeationSkip({ ...plain, ...directed } as typeof plain), `skips ${JSON.stringify(directed)}`);
  }
}

// 7. Off reproduces today's output for the same seed: the teaser rotation decides access, the step never
// runs, and the generator reads exactly what the spice planner and the closet gave it.
{
  for (const creator of ["creator-a", "creator-b"]) {
    for (let sequence = 0; sequence < 100; sequence += 1) {
      for (const rate of ["off", "rare", "regular", "often"] as const) {
        assert.equal(
          slurpAutomaticPostFree(creator, sequence, { teaserRate: rate, characterLedIdeas: false, lockedShare: 0.1 }),
          slurpTeaserPost(creator, sequence, rate),
        );
      }
    }
  }
  assert.equal(slurpIdeationSkip({ enabled: false } as Parameters<typeof slurpIdeationSkip>[0]), "off");
  const service = slurp2Source(
    "packages/slurp2/src/engine/packages/server/src/slp/features/feed/slp-post-ideation-service.ts",
  );
  assert.match(service, /if \(skip === "off"\) return planned;/u);
  assert.match(service, /slurpPostCloset\(closet, \{ level, access, intent, scene: context\.scene \}\)/u);
  const access = slurp2Source(
    "packages/slurp2/src/engine/packages/server/src/slp/features/feed/slp-post-ideation-access.ts",
  );
  assert.match(access, /if \(!settings\.characterLedIdeas\) return resolveSlurpTeaserAccess\(noodle, accountId\);/u);
  const generation = slurp2Source(
    "packages/slurp2/src/engine/packages/server/src/slp/features/feed/slp-generation-service.ts",
  );
  assert.equal(generation.match(/planSlurpPostIdea\(/gu)?.length, 1, "one call site");
  assert.doesNotMatch(generation, /planSlurpPostSpice\(/u);
}

// The idea drives the writer and the picture: its line replaces the beat, its place and moment the scene.
{
  const idea = slurpCheckPostIdea(answer(), input(), []).idea!;
  const variation = slurpPostVariation("creator-a", 3, "off");
  const applied = slurpApplyPostIdea({
    idea,
    planned: null,
    cast: input().cast,
    variation,
    looks: [],
    camera: "selfie",
  });
  assert.match(applied.beat.line, /Buddenbrooks/u);
  assert.match(applied.beat.line, /For subscribers: The whole reading/u);
  assert.equal(applied.beat.anchor, "first editions");
  assert.equal(applied.variation.place, "his study");
  assert.equal(applied.variation.moment, "turning the first page");
  assert.equal(applied.camera, "tripod", "the framing comes from the idea's camera");
  assert.equal(applied.angle, null, "a clean idea has no spicy angle");
  assert.equal(applied.postLevel, "none");
  assert.deepEqual((applied.metadata.slurpIdea as { subject: string }).subject, "first editions");
}

retries().then(
  () => console.log("slurp2 character-led ideas regression checks passed"),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);

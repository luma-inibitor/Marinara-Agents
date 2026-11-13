import assert from "node:assert/strict";
import {
  compileSlurpFlavourBrief,
  CORE_DESCRIPTION_MAX,
  CORE_PERSONALITY_MAX,
} from "../packages/slurp2/src/engine/packages/server/src/slp/modules/creators/slp-creator-flavour.ts";

// The core, shown in every brief, holds far more of the card. At 360 and 240 characters it was a
// name and an occupation, and the rest of a 20,000-character card came in as four rotating details.
assert.equal(CORE_DESCRIPTION_MAX, 1500);
assert.equal(CORE_PERSONALITY_MAX, 600);

const sentences = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix} fact number ${index} is true about him today.`);
const description = sentences("Description", 60);
const personality = sentences("Personality", 30);
const brief = compileSlurpFlavourBrief(
  {
    accountId: "a",
    name: "Kurtz",
    card: {
      description: [description[0], "{{user}} is his new recruit.", ...description.slice(1)].join(" "),
      personality: personality.join(" "),
    },
  },
  { use: "post", sequence: 0 },
);
const core = brief.text.split("\n\n")[0]!;
const coreDescription = description.filter((sentence) => core.includes(sentence)).join(" ");
const corePersonality = personality.filter((sentence) => core.includes(sentence)).join(" ");
// Whole sentences up to the budget: close to it, never far over one sentence past it.
assert.ok(coreDescription.length > CORE_DESCRIPTION_MAX - 60 && coreDescription.length <= CORE_DESCRIPTION_MAX + 60);
assert.ok(corePersonality.length > CORE_PERSONALITY_MAX - 60 && corePersonality.length <= CORE_PERSONALITY_MAX + 60);
// In order, from the start of each field.
assert.ok(core.startsWith(description[0]!));
assert.ok(core.includes(personality[0]!));
// A sentence about the player never reaches the core.
assert.doesNotMatch(brief.text, /\{\{user\}\}|new recruit/u);
// What is past the budget still rotates in as details.
assert.ok(brief.shaped.details.length > 0);

console.log("slurp2 card core regression checks passed");

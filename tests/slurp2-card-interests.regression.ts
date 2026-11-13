import assert from "node:assert/strict";
import { compileSlurpFlavourBrief } from "../packages/slurp2/src/engine/packages/server/src/slp/modules/creators/slp-creator-flavour.ts";

// A card's interests reach the writer in every post, and section headings are not details. A
// "Likes:" line used to be an ordinary detail at weight 1 in one of two alternating halves: one
// Creator's Chopin, Mahler and first editions appeared in 0 of 10 posts, while "> SEXUALITY" did.
const description = [
  "Dr. Veill is a behavioural scientist who runs a private clinic.",
  "> Identity",
  "## Appearance",
  "> SEXUALITY",
  "BEHAVIOR",
  "Background:",
  "[Backstory]",
  "He trained in Vienna and keeps meticulous notes.",
  "He wears pressed grey suits.",
  "He drinks his coffee black.",
  "His office smells of old paper.",
  "He keeps a bonsai on the windowsill.",
  "He rarely raises his voice.",
  "He reads late into the night.",
  "He has a sister in Graz.",
  "He walks to work every morning.",
  "He was married once, briefly.",
].join("\n");
const personality = "Cold, exact and patient. Archetype: The Dark Pygmalion. Never hurried.";
// The backstory goes to the details whole, whatever room the core has.
const backstory = [
  "He grew up above a bookshop.",
  "Likes: Chopin, Mahler, Nietzsche, Mann, first editions, gardening",
  "He left medicine after one bad year.",
  "Hobbies - restoring pre-1970 films",
  "> BEHAVIOR",
].join("\n");
const card = { description, personality, backstory };

const headers = /^(> Identity|## Appearance|> SEXUALITY|BEHAVIOR|> BEHAVIOR|Background:|\[Backstory\])$/u;
let posts = 0;
for (let sequence = 0; sequence < 60; sequence += 1) {
  const brief = compileSlurpFlavourBrief({ accountId: "veill", name: "Dr. Veill", card }, { use: "post", sequence });
  const kinds = brief.shaped.details.map((detail) => detail.kind);
  assert.equal(kinds.filter((kind) => kind === "interests").length >= 1, true, `post ${sequence} has an interest`);
  assert.ok(brief.shaped.details.length >= 2, "the interest comes on top of other details");
  for (const detail of brief.shaped.details) assert.doesNotMatch(detail.text, headers, "no heading is a detail");
  assert.doesNotMatch(
    brief.text,
    /SEXUALITY|BEHAVIOR|> Identity|## Appearance|Background:|\[Backstory\]/u,
    "no heading anywhere",
  );
  posts += 1;
}
assert.equal(posts, 60);

// Both interest lines take turns, so consecutive posts are not stuck on one.
const shown = new Set(
  Array.from({ length: 40 }, (_, sequence) =>
    compileSlurpFlavourBrief({ accountId: "veill", name: "Dr. Veill", card }, { use: "post", sequence })
      .shaped.details.filter((detail) => detail.kind === "interests")
      .map((detail) => detail.text),
  ).flat(),
);
assert.equal(shown.size, 2, `both interest lines are used: ${[...shown].join(" | ")}`);

// Prose that names hobbies is an interest too (backstory goes to the details whole).
const prose = compileSlurpFlavourBrief(
  {
    accountId: "cheney",
    name: "Dick",
    card: {
      description: "Dick is a former vice president.",
      backstory: "He lives in Wyoming. His hobbies include fly-fishing and reading history.",
    },
  },
  { use: "post", sequence: 1 },
);
assert.ok(prose.shaped.details.some((detail) => detail.kind === "interests" && /fly-fishing/u.test(detail.text)));

// A card with no interests gets no interest detail.
const none = compileSlurpFlavourBrief(
  { accountId: "x", name: "X", card: { description: "X is a baker. X lives above the shop. X has a dog." } },
  { use: "post", sequence: 2 },
);
assert.ok(none.shaped.details.every((detail) => detail.kind !== "interests"));
// A heading line with content after it stays, and so does a label with a value.
const kept = compileSlurpFlavourBrief(
  {
    accountId: "y",
    name: "Y",
    card: { description: "Y is a pilot.", personality: "Archetype: The Dark Pygmalion." },
  },
  { use: "post", sequence: 0 },
);
assert.match(kept.text, /Archetype: The Dark Pygmalion/u);

console.log("slurp2 card interests regression checks passed");

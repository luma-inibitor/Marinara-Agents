import assert from "node:assert/strict";
import { compileSlurpFlavourBrief } from "../packages/slurp2/src/engine/packages/server/src/slp/modules/creators/slp-creator-flavour.ts";
import { slurp2Source } from "./slurp2-source";

// The overused-opener check reads every recent post, paid ones included. It used to read public
// posts only, and with most posts locked it never fired: one Creator opened 21 of 30 posts the same way.
const locked = [
  "Let me make one thing perfectly clear about the budget.",
  "Let me make this simple for the press.",
  "Let me make an observation about loyalty.",
  "Let me make it plain, the tapes stay.",
  "Quiet evening with the dog.",
];
const publicLines = ["A long walk on the beach today.", "Reading the papers by the fire."];
const brief = compileSlurpFlavourBrief(
  {
    accountId: "creator-a",
    name: "Dick",
    card: { description: "A retired politician who writes his memoirs." },
    ownLines: publicLines,
    signatureLines: [...locked, ...publicLines],
  },
  { use: "post", sequence: 4 },
);
assert.equal(brief.shaped.opener?.phrase, "Let me make", "the opener shared by locked posts is found");

// Without paid lines the old behaviour stands: two public lines show no habit.
const publicOnly = compileSlurpFlavourBrief(
  { accountId: "creator-a", name: "Dick", card: { description: "A retired politician." }, ownLines: publicLines },
  { use: "post", sequence: 4 },
);
assert.equal(publicOnly.shaped.opener, null);

// Paid lines are never used as the voice sample: the sample still comes from public lines only.
for (let sequence = 0; sequence < 20; sequence += 1) {
  const sample = compileSlurpFlavourBrief(
    {
      accountId: "creator-a",
      name: "Dick",
      card: { description: "A retired politician." },
      ownLines: [...publicLines, ...publicLines.map((line) => `${line} Again.`)],
      signatureLines: locked,
    },
    { use: "post", sequence },
  ).sample;
  assert.ok(!sample || !locked.includes(sample), `sequence ${sequence}: a paid line was quoted`);
}

// Wiring: the post passes every recent post for the check, and the default read keeps all of them.
const server = (path: string) => slurp2Source(`packages/slurp2/src/engine/packages/server/src/slp/${path}`);
assert.match(server("features/feed/slp-generation-service.ts"), /ownPosts: recentPosts,/u);
assert.match(server("data/creators/slp-flavour-source.ts"), /recent\.map\(\(post\) => post\.content\)/u);

console.log("slurp2 opener over all posts regression checks passed");

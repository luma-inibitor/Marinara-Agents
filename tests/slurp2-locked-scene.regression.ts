import assert from "node:assert/strict";
import {
  slurpLockedKeepsScene,
  slurpSpiceAngle,
} from "../packages/slurp2/src/engine/packages/server/src/slp/modules/creators/slp-spice.ts";
import { SLP_DEFAULT_SPICE } from "../packages/slurp2/src/engine/packages/shared/src/slp/slp-spice.ts";
import { slurp2Source } from "./slurp2-source";

// About half of a Creator's own locked posts keep their ordinary scene. Every locked post used to get
// a spicy angle whose moment replaced the picture's, so 18-22 of 30 posts on a page were undressing.
for (const seed of ["creator-a", "creator-b", "creator-c"]) {
  const kept = Array.from({ length: 400 }, (_, sequence) => slurpLockedKeepsScene(seed, sequence)).filter(Boolean);
  assert.ok(kept.length > 400 * 0.4 && kept.length < 400 * 0.6, `${seed}: ${kept.length} of 400 kept the scene`);
}
// Fixed per post: the same post decides the same way every time.
for (let sequence = 0; sequence < 50; sequence += 1)
  assert.equal(slurpLockedKeepsScene("creator-a", sequence), slurpLockedKeepsScene("creator-a", sequence));

// The planner skips the angle on those posts, except for a teased drop and a collab or couple post.
const plan = slurp2Source("packages/slurp2/src/engine/packages/server/src/slp/features/feed/slp-post-spice.ts");
assert.match(
  plan,
  /locked && ownPost && !input\.teasedKind && slurpLockedKeepsScene\(input\.account\.id, input\.sequence\)/u,
);
assert.match(plan, /spiceRead && !input\.directed && spicy && !keepsScene/u);

// The kind of the post before does not come back next while another kind is allowed. At
// "suggestive" there are two kinds, so the kinds alternate.
const base = {
  level: "suggestive" as const,
  ceiling: "suggestive" as const,
  access: "locked" as const,
  teaser: false,
  creator: { accountId: "creator-a", text: "Climbing coach.", turnOns: [], hardNoes: [], anchors: null },
  spice: SLP_DEFAULT_SPICE,
};
let recent: { kind: string }[] = [];
let repeats = 0;
const seen = new Set<string>();
for (let sequence = 0; sequence < 60; sequence += 1) {
  const angle = slurpSpiceAngle({ ...base, recent, sequence });
  assert.ok(angle, "a suggestive locked post has an angle");
  seen.add(angle.kind);
  if (recent[0]?.kind === angle.kind) repeats += 1;
  recent = [{ kind: angle.kind }, ...recent].slice(0, 30);
}
assert.ok(seen.size >= 2, "more than one kind is used");
assert.equal(repeats, 0, "no kind repeats back to back while another is allowed");

// A teased drop still delivers the kind its tease hinted at, even when it was the kind before.
const teased = slurpSpiceAngle({ ...base, recent: [{ kind: [...seen][0]! }], sequence: 3, teasedKind: [...seen][0]! });
assert.equal(teased?.kind, [...seen][0]);

console.log("slurp2 locked scene regression checks passed");

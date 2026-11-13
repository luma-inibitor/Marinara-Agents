import assert from "node:assert/strict";
import type { SlpWardrobeLook } from "../packages/slurp2/src/engine/packages/shared/src/slp/slp-wardrobe";
import { resolveSlurpWardrobeSelection } from "../packages/slurp2/src/engine/packages/server/src/slp/modules/feed/slp-wardrobe-selection";
import { slurpPictureOutfit } from "../packages/slurp2/src/engine/packages/server/src/slp/modules/feed/slp-image-brief";

const suit: SlpWardrobeLook = {
  id: "suit",
  name: "Office",
  summary: "suit",
  description: "a charcoal suit and a silk tie",
  tags: ["suit"],
  suitability: "both",
  enabled: true,
  source: { kind: "manual" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const scene = (wardrobeId: string | null, outfit?: string) => ({
  wardrobeId,
  setting: "a messy bedroom",
  action: "stretching",
  expression: "sleepy",
  visualDirection: "morning light",
  ...(outfit === undefined ? {} : { outfit }),
});

// The writer gave no look but wrote an outfit: no saved look replaces it, at a clothed level too.
const own = resolveSlurpWardrobeSelection({
  looks: [suit],
  access: "public",
  scene: scene(null, "a white undershirt and briefs"),
  creatorName: "Mia",
});
assert.equal(own.look, null, "a null wardrobeId with an outfit keeps the writer's outfit");
assert.equal(own.fallback, false);
assert.equal(
  slurpPictureOutfit({ level: "suggestive", selected: own.look?.description, scene: "a white undershirt and briefs" }),
  "a white undershirt and briefs",
);

// A look the writer named but cannot be used still gives way to the writer's own outfit.
const unknown = resolveSlurpWardrobeSelection({
  looks: [suit],
  access: "public",
  scene: scene("gone", "a white undershirt and briefs"),
  creatorName: "Mia",
});
assert.equal(unknown.look, null);
assert.equal(unknown.requestedId, "gone");
assert.equal(unknown.fallback, true);

// Without an outfit of its own, the scene still gets a saved look, as before.
assert.equal(
  resolveSlurpWardrobeSelection({ looks: [suit], access: "public", scene: scene(null), creatorName: "Mia" }).look?.id,
  "suit",
);
assert.equal(
  resolveSlurpWardrobeSelection({ looks: [suit], access: "public", scene: scene(null, "  "), creatorName: "Mia" }).look
    ?.id,
  "suit",
  "a blank outfit is no outfit",
);
// A look the writer chose wins over its outfit text.
assert.equal(
  resolveSlurpWardrobeSelection({
    looks: [suit],
    access: "public",
    scene: scene("suit", "jeans"),
    creatorName: "Mia",
  }).look?.id,
  "suit",
);

console.log("slurp2 writer outfit regression checks passed");

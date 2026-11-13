import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import { stripMacroComments } from "@marinara-engine/shared";
import { slurp2Source } from "./slurp2-source";

// The vendored copy Slurp bundles, run with its picture readers stubbed (as the Noodle image regression does).
const references: Record<string, unknown> = {
  stripMacroComments,
  readAvatarBase64: () => undefined,
  readPreferredFullBodySpriteBase64: () => undefined,
};
runInNewContext(
  stripTypeScriptTypes(
    readFileSync(
      new URL("../sources/engine/packages/server/src/services/image/illustrator-references.ts", import.meta.url),
      "utf8",
    )
      .replace(/^import .*$/gmu, "")
      .replace(/^export /gmu, ""),
  ),
  references,
);
const resolveIllustratorCharacterReferences = references.resolveIllustratorCharacterReferences as (
  args: Record<string, unknown>,
) => Promise<{ characterIds: string[] }>;

// Upstream Engine fix 314a71a586 (#5865), carried into Slurp's vendored copy: only the characters in the
// picture match prompt text; anyone else in the library needs their unique full name asked for.

const cards = [
  { id: "adrian", name: "Adrian" },
  { id: "veill", name: "Dr. Veill" },
  { id: "ryan", name: "Ryan" },
];
const charactersStore = {
  list: async () => cards.map(({ id, name }) => ({ id, data: { name, appearance: `${id} appearance` } })),
};
const chat = (...ids: string[]) =>
  cards.filter((card) => ids.includes(card.id)).map((card) => ({ ...card, avatarPath: null, appearance: "" }));

async function main() {
  // A Creator's own picture (`slp-images-service.ts`): their brief names another card's alias as a place.
  {
    const own = await resolveIllustratorCharacterReferences({
      charactersStore,
      chatCharacters: chat("adrian"),
      persona: null,
      requestedNames: ["Adrian"],
      promptText: ["Adrian", "Back from a shift at the Veill Wellness Center.", "Adrian in scrubs"].join("\n"),
      maxReferences: 6,
      includeReferenceImages: false,
    });
    assert.deepEqual([...own.characterIds], ["adrian"], "a place named after another card brings no reference");
  }

  // A collab's partner in the picture (`slp-image-companions.ts`) still brings their reference.
  {
    const partner = await resolveIllustratorCharacterReferences({
      charactersStore,
      chatCharacters: chat("ryan"),
      persona: null,
      requestedNames: ["Ryan"],
      promptText: "Adrian and Ryan spar at the Veill Wellness Center gym.",
      maxReferences: 6,
      includeReferenceImages: false,
    });
    assert.deepEqual([...partner.characterIds], ["ryan"]);
  }

  // A public post with active accounts (`slp-public-images-service.ts`): only those accounts match the text.
  {
    const group = await resolveIllustratorCharacterReferences({
      charactersStore,
      chatCharacters: chat("adrian", "ryan"),
      persona: null,
      requestedNames: ["Adrian"],
      promptText: "Adrian and Ryan outside the Veill Wellness Center.",
      maxReferences: 6,
      includeReferenceImages: false,
    });
    assert.deepEqual([...group.characterIds], ["adrian", "ryan"]);
  }

  // Noodle opts back into the whole library: a post may name any card.
  {
    const noodle = await resolveIllustratorCharacterReferences({
      charactersStore,
      chatCharacters: chat("adrian"),
      persona: null,
      requestedNames: ["Adrian"],
      promptText: "Adrian ran into Dr. Veill today.",
      maxReferences: 6,
      includeReferenceImages: false,
      matchLibraryInPrompt: true,
    });
    assert.deepEqual([...noodle.characterIds], ["adrian", "veill"]);
  }
}

// The callers keep passing the Creator, and only the people in the picture, as the chat characters.
const media = (file: string) =>
  slurp2Source(`packages/slurp2/src/engine/packages/server/src/slp/features/media/${file}`);
assert.match(media("slp-images-service.ts"), /chatCharacters: \[\n\s*\{\n\s*id: row\.id,/u);
assert.match(media("slp-public-images-service.ts"), /\[input\.account, \.\.\.input\.referenceAccounts\]/u);
assert.match(media("slp-image-companions.ts"), /chatCharacters: refs\.map\(/u);
assert.doesNotMatch(media("slp-images-service.ts") + media("slp-public-images-service.ts"), /matchLibraryInPrompt/u);

main().then(
  () => console.log("slurp2 reference scope regression checks passed"),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);

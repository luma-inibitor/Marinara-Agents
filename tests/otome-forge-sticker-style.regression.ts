// A run's `images.stickerStyle` replaces the default chibi look of its stickers, and of their design call, while the
// bust crop, the matte and the no-outline rule the cut-out needs stay. Empty keeps the default prompts unchanged.
import assert from "node:assert/strict";
import test from "node:test";
import type {
  OtomeReply,
  RouteHandler,
} from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/http.ts";
import {
  STICKER_FRAMING,
  stickerPrompt,
  stickerSetMessages,
} from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/prompts.ts";
import { worldId } from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/ids.ts";
import { registerRunRoutes } from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/routes/runs.ts";
import { normalizeWorld } from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/schemas/world.ts";
import { storyWorld } from "./fixtures/otome-forge-story.ts";

const PAINTED =
  "painted chat sticker, head and shoulders fill the frame, normal adult proportions, expressive face, soft painted shading, fine dark edge lines, semi-realistic";
const style = { styleText: "soft watercolor", positiveTags: "pastel", negativeTags: "blurry" };
const unit = {
  name: "Kai",
  pronouns: { subject: "he", object: "him", possessive: "his" },
  identityLine: "tall man, green eyes, black hair",
  outfitLine: "navy coat",
  bible: undefined,
};

function sticker(stickerStyle?: string) {
  return stickerPrompt({
    name: "Kai",
    identityLine: unit.identityLine,
    outfitLine: unit.outfitLine,
    presentation: "man",
    look: "chibi bust, smirking, one eyebrow raised",
    world: normalizeWorld({ images: stickerStyle === undefined ? {} : { stickerStyle } }),
    style,
  });
}

function design(stickerStyle?: string) {
  return stickerSetMessages({ unit, language: "English", others: [], stickerStyle })[0]!.content;
}

test("without a sticker style the sticker and its design call are upstream's", () => {
  assert.equal(
    STICKER_FRAMING,
    "2D anime chibi sticker, chibi bust, head and shoulders only, big head, expressive face, thick clean line art, flat cel shading, no white outline around the figure",
  );
  assert.equal(
    sticker().prompt,
    "soft watercolor, tall man, green eyes, black hair, chibi bust, smirking, one eyebrow raised, navy coat, 2D anime chibi sticker, head and shoulders only, big head, expressive face, thick clean line art, flat cel shading, no white outline around the figure, plain flat solid chroma magenta #FF00FF background, safe for work, fully clothed, adult man, pastel",
  );
  assert.deepEqual(sticker(""), sticker());
  assert.deepEqual(sticker("   "), sticker());
  assert.match(
    design(),
    /9 2D anime chibi stickers of Kai, in the spirit of a game's character sticker sets \(Genshin/u,
  );
  assert.match(design(), /the expression and pose of a chibi bust,/u);
  assert.equal(design(""), design());
});

test("a sticker style replaces the chibi look and keeps the cut-out's crop, matte and no outline", () => {
  const built = sticker(PAINTED);
  assert.ok(built.prompt.startsWith("soft watercolor, tall man, green eyes, black hair, bust, smirking"), built.prompt);
  assert.ok(built.prompt.includes(PAINTED), built.prompt);
  assert.doesNotMatch(built.prompt, /anime|chibi|cel shading|big head|line art/iu);
  assert.match(built.prompt, /head and shoulders bust, head and shoulders only, no white outline around the figure/u);
  assert.match(built.prompt, /plain flat solid chroma magenta #FF00FF background/u);
  assert.match(built.prompt, /safe for work, fully clothed, adult man/u);
  assert.equal(built.negativePrompt, sticker().negativePrompt);
});

test("the design call follows the sticker style", () => {
  const system = design(PAINTED);
  assert.doesNotMatch(system, /anime|chibi|Genshin/iu);
  assert.ok(system.includes(`all drawn in this style: ${PAINTED}.`), system);
  assert.match(system, /the expression and pose of a head and shoulders bust,/u);
});

test("POST /runs/:run/settings saves, trims and clears the sticker style", async () => {
  const t = await storyWorld({ runKey: "r-ststyle-aaaaaa" });
  const routes = new Map<string, RouteHandler>();
  registerRunRoutes(
    {
      get: (path: string, handler: RouteHandler) => routes.set(`GET ${path}`, handler),
      post: (path: string, handler: RouteHandler) => routes.set(`POST ${path}`, handler),
    },
    t.deps,
  );
  const save = async (images: object) => {
    let status = 200;
    let payload: unknown;
    const reply: OtomeReply = {
      status(code) {
        status = code;
        return reply;
      },
      send(value) {
        payload = value;
        return reply;
      },
    };
    const result = await routes.get("POST /runs/:run/settings")!(
      {
        method: "POST",
        url: "/runs/:run/settings",
        body: { timeZone: "UTC", debugMode: true, images },
        params: { run: "r-ststyle-aaaaaa" },
        query: {},
      },
      reply,
    );
    return { status, body: (result === reply ? payload : result) as Record<string, any> };
  };
  const saved = await save({ stickerStyle: `  ${PAINTED}  ` });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.world.images.stickerStyle, PAINTED);
  const world = async () => (await t.store.readDoc(worldId(t.runId), normalizeWorld))!;
  assert.equal((await world()).images.stickerStyle, PAINTED);
  assert.equal((await save({ ask: true })).body.world.images.stickerStyle, PAINTED, "other settings keep it");
  assert.equal((await save({ stickerStyle: "x".repeat(601) })).status, 400);
  assert.equal((await save({ stickerStyle: "" })).body.world.images.stickerStyle, "");
  assert.equal((await world()).images.stickerStyle, "");
});

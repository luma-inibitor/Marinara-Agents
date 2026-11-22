// Looks and portraits use the base art as their likeness, looks follow the world's framing, each purpose may have its
// own connection, and expression edits use the love interest's own face notes.
import assert from "node:assert/strict";
import test from "node:test";
import { createImageClient } from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/art/image-client.ts";
import {
  expressionPrompt,
  faceNotesMessages,
  lookPrompt,
} from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/prompts.ts";
import { normalizeUnit } from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/schemas/unit.ts";
import { normalizeWorld } from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/schemas/world.ts";
import { imageConnectionFor } from "../packages/otome-forge/src/engine/packages/client/src/features/otome-forge/shared/image-purpose.ts";
import type { FaceNotes } from "../packages/otome-forge/src/engine/packages/client/src/features/otome-forge/shared/api-types.ts";
import { PNG } from "./fixtures/otome-forge-art.ts";
import { bible } from "./fixtures/otome-forge-story.ts";

const data = (value: string) => `data:image/png;base64,${Buffer.from(value).toString("base64")}`;
const baseArt = "/api/global-gallery/file/installed-sprite.png";
const request = {
  connectionId: "image-connection",
  name: "Veill",
  prompt: "charcoal waistcoat",
  negativePrompt: "text",
  width: 832,
  height: 1216,
  debugMode: false,
};

function engine(missing: string[] = []) {
  const generations: Array<{ referenceImages?: string[] }> = [];
  const client = createImageClient({
    baseUrl: "http://127.0.0.1:9",
    logger: { debug: () => undefined, warn: () => undefined },
    fetch: (async (url, init) => {
      const path = String(url).replace("http://127.0.0.1:9", "");
      if (missing.includes(path)) return new Response("missing", { status: 404 });
      if (/^\/api\/sprites\/[^/]+$/u.test(path)) {
        return Response.json([{ expression: "full_neutral", filename: "full_neutral.png" }]);
      }
      if (path.startsWith("/api/sprites/") || path.startsWith("/api/avatars/file/")) {
        return new Response(path, { headers: { "content-type": "image/png" } });
      }
      if (path.startsWith("/api/global-gallery/file/")) {
        return new Response(path, { headers: { "content-type": "image/png" } });
      }
      if (path === "/api/characters/avatar-generation") {
        const body = JSON.parse(String(init?.body));
        generations.push(body);
        return Response.json({ image: `data:image/png;base64,${PNG}`, prompt: body.promptOverrides[0].prompt });
      }
      if (/^\/api\/characters\/[^/]+$/u.test(path)) return Response.json({ avatarPath: "/api/avatars/file/card.png" });
      if (path === "/api/global-gallery/upload") return Response.json({ id: "painted", url: "/painted.png" });
      if (path === "/api/app-settings/ui") return Response.json({ value: {} });
      assert.fail(`unexpected fetch ${path}`);
    }) as typeof globalThis.fetch,
  });
  return { client, generations };
}

test("a look and a portrait send the base art alone; scenes and a missing base keep the card's likeness", async () => {
  const t = engine();
  const unit = { kind: "character" as const, cardId: "card-veill", baseArt };
  await t.client.generateOutfit({ ...request, unit });
  await t.client.generatePortrait({ ...request, unit });
  await t.client.generateBannerArt({ ...request, units: [unit] });
  const neutral = data("/api/sprites/card-veill/file/full_neutral.png");
  assert.deepEqual(
    t.generations.map((call) => call.referenceImages),
    [[data(baseArt)], [data(baseArt)], [neutral]],
  );
  const gone = engine([baseArt]);
  await gone.client.generateOutfit({ ...request, unit });
  assert.deepEqual(gone.generations[0]!.referenceImages, [neutral, data("/api/avatars/file/card.png")]);
});

const look = {
  name: "Veill",
  identityLine: "tall man, grey eyes",
  outfitLine: "charcoal waistcoat",
  presentation: "man" as const,
  style: { styleText: "", positiveTags: "", negativeTags: "" },
  matte: true,
};

test("a look follows the world's framing, and only full body keeps feet in frame", () => {
  const full = lookPrompt({ ...look, world: normalizeWorld({}) });
  assert.match(full.prompt, /full body, standing, neutral pose/u);
  assert.match(full.negativePrompt, /cropped feet/u);
  const thigh = lookPrompt({ ...look, world: normalizeWorld({ images: { lookFraming: "thigh-up" } }) });
  assert.match(thigh.prompt, /shown from mid-thigh up/u);
  assert.doesNotMatch(thigh.prompt, /full body/u);
  assert.doesNotMatch(thigh.negativePrompt, /cropped feet/u);
  assert.match(thigh.prompt, /use it for Veill's face, hair, build and art style/u);
});

test("each purpose uses its own connection, else the story's, and none while images are off", () => {
  const images = normalizeWorld({
    images: { connectionId: "nano", purposeConnections: { scenes: "krea" }, lookFraming: "waist-up" },
  }).images;
  assert.equal(imageConnectionFor(images, "scenes"), "krea");
  assert.equal(imageConnectionFor(images, "sprites"), "nano");
  assert.equal(imageConnectionFor(images, "expressions"), "nano");
  assert.equal(images.lookFraming, "waist-up");
  assert.equal(imageConnectionFor({ ...images, connectionId: null }, "scenes"), null);
});

test("an expression edit uses the love interest's own face line and restraint", () => {
  const faceNotes: FaceNotes = {
    restraint: "His face rarely moves.",
    lines: {
      tender: "a rare, reluctant tender look: the brow eases, a very small closed smile",
      flustered: "a flustered look he refuses to show: a faint flush, eyes cut sideways",
      cold: "a cold look: lowered lids, a flat mouth",
      hurt: "a hurt look held in: inner brows lifted, eyes cast down",
      angry: "a quiet anger: brows lowered hard, jaw clenched",
    },
    at: "2026-11-22T00:00:00.000Z",
  };
  const unit = {
    ...normalizeUnit({ faceNotes }),
    name: "Veill",
    identityLine: "tall man",
    bible: bible({ look: { identityLine: "tall man", outfitLine: "coat", presentation: "man" } }),
  };
  assert.deepEqual(unit.faceNotes, faceNotes);
  const world = normalizeWorld({});
  const style = { styleText: "", positiveTags: "", negativeTags: "" };
  const own = expressionPrompt({ unit, base: "/veill.png", face: "tender", world, style }).prompt;
  assert.match(own, /to a rare, reluctant tender look/u);
  assert.match(own, /His face rarely moves\. Keep it restrained but clearly visible/u);
  assert.match(own, /No tears, no bared teeth, no cartoon effects\./u);
  const stock = expressionPrompt({
    unit: { ...unit, faceNotes: undefined },
    base: "/veill.png",
    face: "tender",
    world,
    style,
  });
  assert.match(stock.prompt, /a tender expression: softened eyes/u);
  const [system, user] = faceNotesMessages({ world, unit });
  assert.match(system!.content, /"restraint": "\.\.\.", "tender": "\.\.\."/u);
  assert.match(user!.content, /VEILL/u);
});

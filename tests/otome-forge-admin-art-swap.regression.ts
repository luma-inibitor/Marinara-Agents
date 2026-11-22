import assert from "node:assert/strict";
import test from "node:test";
import { BASE_LOOK } from "../packages/otome-forge/src/engine/packages/client/src/features/otome-forge/shared/wardrobe.ts";
import type { Item } from "../packages/otome-forge/src/engine/packages/client/src/features/otome-forge/shared/wish.ts";
import { cutoutsSettled } from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/art/cutout.ts";
import type { RouteDeps } from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/http.ts";
import {
  itemId,
  runDocTarget,
  stateId,
  unitId,
} from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/ids.ts";
import {
  registerAdminRoutes,
  type GalleryRow,
} from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/routes/admin.ts";
import { registerWardrobeRoutes } from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/routes/wardrobe.ts";
import { normalizeState } from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/schemas/state.ts";
import { normalizeUnit } from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/schemas/unit.ts";
import { normalizeItem } from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/schemas/wish.ts";
import { artWorld, routesOf } from "./fixtures/otome-forge-art.ts";
import { KAI, at } from "./fixtures/otome-forge-story.ts";

const file = (name: string) => `/api/global-gallery/file/${name}.png`;
const ref = (name: string) => `global-gallery:row-${name}`;
const image = (name: string) => ({ url: file(name), ref: ref(name) });
const FACE_NAMES = ["tender", "flustered", "cold", "hurt", "angry"] as const;
const faces = (prefix: string, names: readonly string[] = FACE_NAMES) =>
  Object.fromEntries(names.map((face) => [face, image(`${prefix}-${face}`)]));
const cutout = (name: string, cleanupRevision = 2) => ({ state: "ready", at, ...image(name), cleanupRevision });

const LOOK: Item = {
  id: "his-wardrobe-0-f",
  kind: "his-look5",
  banner: "his-wardrobe-0",
  li: KAI,
  title: "Harbour Night",
  look: { name: "Harbour Night", outfitLine: "navy greatcoat" },
  art: { state: "ready", at, ...image("look-old") },
  story: null,
  createdAt: at,
};

const NEW_FILES = ["base-new", "cut-new", "look-new", "tender-new", "loose-new"];

async function swapWorld(runKey: string, { revision = 2, rows }: { revision?: number; rows?: GalleryRow[] } = {}) {
  const t = await artWorld({ runKey });
  await t.store.updateDoc(runDocTarget("unit", unitId(t.runId, KAI)), normalizeUnit, (unit) => ({
    ...unit,
    portrait: file("base-old"),
    portraitRef: ref("base-old"),
    art: { state: "ready", at, ...image("base-old") },
    outfits: [{ id: LOOK.id, name: "Harbour Night", outfitLine: "navy greatcoat", at, ...image("look-old") }],
    expressions: {
      [file("base-old")]: { state: "ready", at, images: faces("base-old") },
      [file("look-old")]: { state: "ready", at, images: faces("look-old", ["tender", "cold"]) },
    },
    cutouts: {
      [file("base-old")]: cutout("cut-old", 1),
      [file("look-old")]: cutout("look-cut-old", 1),
    },
  }));
  await t.store.mutateDoc(runDocTarget("item", itemId(t.runId, LOOK.id)), normalizeItem, () => LOOK);
  await t.store.updateDoc(runDocTarget("state", stateId(t.runId)), normalizeState, (state) => ({
    ...state,
    owned: { items: [LOOK.id] },
  }));
  const gallery = rows ?? NEW_FILES.map((name) => ({ id: `row-${name}`, filePath: `global/${name}.png` }));
  const deps: RouteDeps = {
    ...t.deps,
    cutouts: {
      cleanupRevision: async () => revision,
      cutOut: async (url) => ({ url: `${url}.cut.png`, id: `cut-${url}` }),
      deleteGalleryImage: async () => true,
    },
  };
  const call = routesOf(
    (router, routeDeps) => {
      registerAdminRoutes(router, routeDeps, { gallery: { rows: async () => gallery } });
      registerWardrobeRoutes(router, routeDeps);
    },
    deps,
    runKey,
  );
  const swap = (body: object) => call("POST", "/runs/:run/admin/art-swap", body);
  const unit = async () => (await t.store.readDoc(unitId(t.runId, KAI), normalizeUnit))!;
  const snapshot = () => JSON.stringify([...t.fake.rows.values()].map((row) => [row.id, row.revision, row.data]));
  return { ...t, call, swap, unit, snapshot };
}

const to = (name: string) => ({ url: file(name), ref: ref(name) });

test("art-swap replaces urls, paired refs and map keys, and the Wardrobe reads the new art at once", async () => {
  const t = await swapWorld("r-swapall-aaaaaa");
  const answer = await t.swap({
    swaps: [
      { from: { url: file("base-old") }, to: to("base-new") },
      { from: { url: file("cut-old") }, to: to("cut-new") },
      { from: { url: file("base-old-tender") }, to: to("tender-new") },
      { from: { url: file("look-old") }, to: to("look-new") },
    ],
  });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.equal(answer.body.dryRun, false);
  assert.equal(answer.body.cleanupRevision, 2);

  const unit = await t.unit();
  assert.equal(unit.portrait, file("base-new"));
  assert.equal(unit.portraitRef, ref("base-new"));
  assert.deepEqual([unit.art?.url, unit.art?.ref], [file("base-new"), ref("base-new")]);
  assert.deepEqual([unit.outfits[0]!.url, unit.outfits[0]!.ref], [file("look-new"), ref("look-new")]);
  assert.deepEqual(Object.keys(unit.expressions).sort(), [file("base-new"), file("look-new")].sort());
  const set = unit.expressions[file("base-new")] as { images: Record<string, { url: string; ref: string }> };
  assert.deepEqual(set.images.tender, to("tender-new"));
  assert.deepEqual(set.images.cold, image("base-old-cold"), "faces not swapped are kept");
  assert.equal(unit.cutouts[file("base-old")], undefined);
  assert.deepEqual(unit.cutouts[file("base-new")], {
    state: "ready",
    at,
    ...to("cut-new"),
    cleanupRevision: 2,
  });

  const item = (await t.store.readDoc(itemId(t.runId, LOOK.id), normalizeItem))!;
  assert.deepEqual([item.art?.url, item.art?.ref], [file("look-new"), ref("look-new")]);

  const docs = Object.fromEntries(answer.body.docs.map((doc: { id: string }) => [doc.id, doc]));
  assert.equal(docs[unitId(t.runId, KAI)].replaced, 9);
  assert.equal(docs[itemId(t.runId, LOOK.id)].replaced, 1);
  const replaced = Object.fromEntries(
    answer.body.replacedRefs.map((entry: { ref: string; heldBy: string[] }) => [entry.ref, entry.heldBy]),
  );
  assert.deepEqual(replaced[ref("base-old")], []);
  assert.deepEqual(replaced[ref("look-old")], []);

  const codes = answer.body.warnings.map((warning: { code: string; url: string }) => `${warning.code} ${warning.url}`);
  assert.ok(codes.includes(`cutout-stale ${file("look-new")}`), JSON.stringify(codes));
  assert.ok(codes.includes(`cutout-unchanged ${file("look-new")}`), JSON.stringify(codes));
  assert.ok(!codes.some((code: string) => code.startsWith("faces-")), "the worn base look has a full ready set");

  const wardrobe = await t.call("GET", "/runs/:run/wardrobe");
  assert.equal(wardrobe.status, 200, JSON.stringify(wardrobe.body));
  const looks = wardrobe.body.him[KAI] as Array<{
    id: string;
    url?: string;
    art: { url?: string } | null;
    faces?: Record<string, string>;
  }>;
  const base = looks.find((look) => look.id === BASE_LOOK)!;
  assert.deepEqual(
    [base.url, base.art?.url, base.faces?.tender],
    [file("cut-new"), file("base-new"), file("tender-new")],
  );
  const look = looks.find((entry) => entry.id === LOOK.id)!;
  assert.equal(look.art?.url, file("look-new"));
  assert.equal(look.url, file("look-cut-old"), "a cut-out left unswapped still shows, as cutout-unchanged warns");
  await cutoutsSettled();
});

test("art-swap warns about the worn look's faces and leaves held old refs listed", async () => {
  const t = await swapWorld("r-swapwarn-aaaaaa");
  await t.store.updateDoc(runDocTarget("unit", unitId(t.runId, KAI)), normalizeUnit, (unit) => ({
    ...unit,
    wornOutfit: LOOK.id,
  }));
  const answer = await t.swap({
    swaps: [{ from: { url: file("look-old") }, to: to("look-new") }],
    docs: [`unit:${KAI}`],
  });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.deepEqual(
    answer.body.docs.map((doc: { id: string }) => doc.id),
    [unitId(t.runId, KAI)],
    "docs limits the scope",
  );
  const item = (await t.store.readDoc(itemId(t.runId, LOOK.id), normalizeItem))!;
  assert.equal(item.art?.url, file("look-old"), "a document outside docs is untouched");
  const codes = answer.body.warnings.map((warning: { code: string }) => warning.code);
  assert.ok(codes.includes("faces-incomplete"), JSON.stringify(codes));
  assert.deepEqual(answer.body.replacedRefs, [
    { ref: ref("look-old"), from: file("look-old"), heldBy: [itemId(t.runId, LOOK.id)] },
  ]);
});

test("art-swap dry run plans without writing", async () => {
  const t = await swapWorld("r-swapdry-aaaaaa");
  const before = t.snapshot();
  const answer = await t.swap({ swaps: [{ from: { url: file("base-old") }, to: to("base-new") }], dryRun: true });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.equal(answer.body.dryRun, true);
  assert.equal(answer.body.docs[0].id, unitId(t.runId, KAI));
  assert.equal(answer.body.docs[0].swaps[file("base-old")], 4);
  assert.equal(t.snapshot(), before);
});

test("art-swap validates every swap before touching anything", async () => {
  const t = await swapWorld("r-swapbad-aaaaaa", {
    rows: [
      { id: "row-base-new", filePath: "global/base-new.png" },
      { id: "row-look-new", filePath: "global/other.png" },
    ],
  });
  const before = t.snapshot();
  const refused = async (body: object, pattern: RegExp) => {
    const answer = await t.swap(body);
    assert.equal(answer.status, 400, JSON.stringify(answer.body));
    assert.match(answer.body.error, pattern);
    assert.equal(t.snapshot(), before, "nothing was written");
  };
  const good = { from: { url: file("base-old") }, to: to("base-new") };
  await refused({ swaps: [good, { from: { url: file("cut-old") }, to: to("cut-new") }] }, /row-cut-new names no/);
  await refused(
    { swaps: [good, { from: { url: file("look-old") }, to: to("look-new") }] },
    /is the file global\/other/,
  );
  await refused({ swaps: [good, { from: { url: file("nowhere") }, to: to("base-new") }] }, /nowhere\.png is not in/);
  await refused({ swaps: [good], docs: ["unit:li-nobody-zz99"] }, /is not a document of this story/);
  await refused({ swaps: [{ from: { url: file("base-old") }, to: { url: file("base-new"), ref: "x" } }] }, /Invalid/);
});

test("art-swap refuses a swap onto a key the map already has", async () => {
  const t = await swapWorld("r-swapkey-aaaaaa", {
    rows: [{ id: "row-look-old", filePath: "global/look-old.png" }],
  });
  const answer = await t.swap({ swaps: [{ from: { url: file("base-old") }, to: to("look-old") }] });
  assert.equal(answer.status, 400, JSON.stringify(answer.body));
  assert.match(answer.body.error, /already has keys/);
});

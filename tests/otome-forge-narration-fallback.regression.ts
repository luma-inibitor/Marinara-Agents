// Otome Forge's narration fallback: a scene that reads as a soft refusal is written once more on the world's
// narrationFallback connection, and the beat records why and which connection wrote it.
import assert from "node:assert/strict";
import test from "node:test";
import type { CapabilityLanguageModelMessage } from "@marinara-engine/shared";
import type {
  ChapterNode,
  ForgeChoice,
  Segment,
} from "../packages/otome-forge/src/engine/packages/client/src/features/otome-forge/shared/api-types.ts";
import { defaultContent } from "../packages/otome-forge/src/engine/packages/client/src/features/otome-forge/shared/content.ts";
import {
  createHandle,
  type OtomeReply,
  type RouteHandler,
} from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/http.ts";
import {
  beatId,
  runDocTarget,
  worldId,
} from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/ids.ts";
import { registerRunRoutes } from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/routes/runs.ts";
import { normalizeBeat } from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/schemas/story.ts";
import { normalizeWorld } from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/schemas/world.ts";
import {
  SHORT_INTIMATE_WORDS,
  fallbackReason,
  intimateNode,
} from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/story/narration-fallback.ts";
import { KAI, beatReply, json, planReply, storyWorld } from "./fixtures/otome-forge-story.ts";
import type { FakeReply } from "./fixtures/otome-forge-fakes.ts";

const EXPLICIT = { ...defaultContent(), heat: "explicit" as const };
const SEX_NODE = "Kai takes Ines to bed in the lamp room. Write it on the page, explicit, and linger.";
const PLAIN_NODE = "The quay goes dark; Kai finds Ines at the lamp.";

const words = (n: number) => Array.from({ length: n }, (_, k) => `word${k}`).join(" ");
const narration = (text: string): Segment => ({ speaker: "", text });
const option = (text: string) => ({
  text,
  selection: { kind: "action" as const, text: `You ${text.toLowerCase()}.` },
  segments: [narration("The lamp hums.")],
});
const scene = (segments: Segment[], choices: ForgeChoice[] = []) => ({ segments, choices });
const smallAt = (at: number): ForgeChoice => ({
  id: "choice-1",
  kind: "small",
  at,
  options: [option("Stay"), option("Go")],
});
const where = (guide: string, last = false, content = EXPLICIT) => ({
  world: { content },
  node: { guide } as Pick<ChapterNode, "guide">,
  last,
});
const stop = { finishReason: "stop", text: "{}" };

test("each trigger fires on its own, and a short scene outside a sex node never does", () => {
  const long = [narration(words(150)), narration(words(150))];
  assert.equal(SHORT_INTIMATE_WORDS, 260);

  assert.equal(
    fallbackReason(scene([narration("I cannot fulfill this request.")]), stop, where(PLAIN_NODE)),
    "refusal",
  );
  assert.equal(
    fallbackReason(
      scene(long),
      { finishReason: "stop", text: "I can't help with that request. {}" },
      where(PLAIN_NODE),
    ),
    "refusal",
  );
  assert.equal(
    fallbackReason(scene([{ speaker: "Kai", text: "I can't help with this, he says." }]), stop, where(PLAIN_NODE)),
    null,
    "a character's own line is never a refusal",
  );
  assert.equal(
    fallbackReason(scene(long), { finishReason: "content_filter", text: "{}" }, where(PLAIN_NODE)),
    "filtered",
  );
  assert.equal(fallbackReason(scene(long), { finishReason: "SAFETY", text: "{}" }, where(PLAIN_NODE)), "filtered");

  assert.equal(fallbackReason(scene([narration(words(229))]), stop, where(SEX_NODE)), "short-intimate");
  assert.equal(fallbackReason(scene([narration(words(260))]), stop, where(SEX_NODE)), null);
  assert.equal(fallbackReason(scene([narration(words(40))]), stop, where(PLAIN_NODE)), null, "a short ordinary scene");
  assert.equal(
    fallbackReason(scene([narration(words(40))]), stop, where(SEX_NODE, false, defaultContent())),
    null,
    "not under NSFW: Explicit",
  );

  assert.equal(fallbackReason(scene(long, [smallAt(1)]), stop, where(SEX_NODE)), "choice-at-end");
  assert.equal(fallbackReason(scene(long, [smallAt(0)]), stop, where(SEX_NODE)), null, "a choice mid-scene");
  assert.equal(fallbackReason(scene(long, [smallAt(1)]), stop, where(SEX_NODE, true)), null, "the chapter's last node");
  assert.equal(fallbackReason(scene(long, [smallAt(1)]), stop, where(PLAIN_NODE)), null, "not a sex node");
});

test("a sex node is read from the guide the planner wrote, not from any use of 'explicit'", () => {
  assert.ok(intimateNode({ content: EXPLICIT }, { guide: SEX_NODE }));
  assert.ok(intimateNode({ content: EXPLICIT }, { guide: "The scene is explicit and ends with a mark." }));
  assert.ok(!intimateNode({ content: EXPLICIT }, { guide: "He stops at an explicit no, and not at silence." }));
  assert.ok(!intimateNode({ content: EXPLICIT }, { guide: "He wants her answer on the page." }));
  assert.ok(!intimateNode({ content: EXPLICIT }, { guide: "She sits her oral exam at dawn." }));
});

const beatPath = "/runs/:run/chapters/:key/beats/:i";
const node0 = { key: "main-1", i: "0" };
const SHORT = beatReply();
const LONG = beatReply({
  segments: [
    { speaker: "", text: words(150), place: "The Lamp Room" },
    { speaker: "Kai", text: "Stay.", expression: "soft" },
    { speaker: "", text: words(150) },
  ],
});
const LONGER = beatReply({
  segments: [...LONG.segments, { speaker: "", text: words(60) }],
});

async function sexScene(runKey: string, replies: FakeReply[], fallback: string | null = "conn-backup") {
  const plan = planReply();
  plan.nodes[0].guide = SEX_NODE;
  const t = await storyWorld({
    runKey,
    content: EXPLICIT,
    replies: [json(plan), ...replies, ...Array.from({ length: 6 }, () => json(beatReply()))],
  });
  if (fallback) {
    await t.store.mutateDoc(runDocTarget("world", worldId(t.runId)), normalizeWorld, (world) => ({
      ...world,
      narrationFallback: fallback,
    }));
  }
  const planned = await t.call("POST", "/runs/:run/chapters/next", { lead: KAI });
  assert.equal(planned.status, 200, JSON.stringify(planned.body));
  const served = await t.call("POST", beatPath, {}, node0);
  await t.settle();
  const narrator = (messages: CapabilityLanguageModelMessage[]) =>
    messages.some((message) => /Narrate node 1 of/u.test(message.content));
  const scenes = t.calls.filter((call) => narrator(call.messages)).map((call) => call.connectionId);
  const stored = await t.store.readDoc(beatId(t.runId, "main-1", 0), normalizeBeat);
  const lines = t.logs.filter((entry) => entry.message.startsWith("[otome-forge/narration]"));
  return { t, served, scenes, stored, lines };
}

test("a short sex scene is written again on the fallback, which is stored with why and by whom", async () => {
  const { served, scenes, stored, lines } = await sexScene("r-fb01-aaaaaa", [json(SHORT), json(LONG)]);
  assert.equal(served.status, 200, JSON.stringify(served.body));
  assert.deepEqual(scenes, ["conn-text", "conn-backup"]);
  assert.equal(stored!.segments[0]!.text, words(150));
  assert.equal(stored!.written.connectionId, "conn-backup");
  assert.deepEqual(stored!.written.fallback, { reason: "short-intimate", from: "conn-text", used: true });
  assert.ok(lines.some((entry) => entry.level === "warn" && entry.args.includes("fallback fired (short-intimate)")));
  assert.ok(lines.some((entry) => entry.args[1] === "conn-backup" && entry.args[3] === 301));
});

test("a fallback that fails keeps the first scene, and one that is also short keeps the longer, with no loop", async () => {
  const failed = await sexScene("r-fb02-bbbbbb", [json(SHORT), new Error("provider down")]);
  assert.equal(failed.served.status, 200, JSON.stringify(failed.served.body));
  assert.deepEqual(failed.scenes, ["conn-text", "conn-backup"]);
  assert.equal(failed.stored!.written.connectionId, "conn-text");
  assert.deepEqual(failed.stored!.written.fallback, { reason: "short-intimate", from: "conn-text", used: false });
  assert.ok(failed.lines.some((entry) => entry.level === "warn" && String(entry.args[2]).includes("provider down")));

  const shorter = beatReply({ segments: [{ speaker: "", text: "Dark.", place: "The Lamp Room" }] });
  const both = await sexScene("r-fb03-cccccc", [json(SHORT), json(shorter)]);
  assert.deepEqual(both.scenes, ["conn-text", "conn-backup"]);
  assert.equal(both.stored!.written.connectionId, "conn-text", "the first scene was longer");
  assert.equal(both.stored!.written.fallback?.used, false);

  const shortLonger = beatReply({ segments: [{ speaker: "", text: words(200), place: "The Lamp Room" }] });
  const longer = await sexScene("r-fb04-dddddd", [json(SHORT), json(shortLonger)]);
  assert.equal(longer.stored!.written.connectionId, "conn-backup", "the fallback's was longer");
  assert.equal(longer.stored!.written.fallback?.used, true);
});

test("a scene the narrator declined is written on the fallback", async () => {
  const refusal = "I cannot fulfill this request.";
  const { served, scenes, stored } = await sexScene("r-fb05-eeeeee", [refusal, refusal, json(LONGER)]);
  assert.equal(served.status, 200, JSON.stringify(served.body));
  assert.deepEqual(scenes, ["conn-text", "conn-text", "conn-backup"]);
  assert.equal(stored!.written.connectionId, "conn-backup");
  assert.deepEqual(stored!.written.fallback, { reason: "declined", from: "conn-text", used: true });
});

test("without a fallback set a short sex scene is stored as before, and every scene logs one line", async () => {
  const { served, scenes, stored, lines } = await sexScene("r-fb06-ffffff", [json(SHORT)], null);
  assert.equal(served.status, 200);
  assert.deepEqual(scenes, ["conn-text"]);
  assert.equal(stored!.written.connectionId, "conn-text");
  assert.equal(stored!.written.fallback, undefined);
  const line = lines.find((entry) => entry.args[0] === "beat/main-1/0")!;
  assert.equal(line.level, "info");
  assert.deepEqual(line.args.slice(1), [
    "conn-text",
    "fake-model",
    13,
    3,
    "stop",
    "would fall back (short-intimate), no fallback set",
  ]);

  const declined = await sexScene(
    "r-fb07-gggggg",
    ["I cannot fulfill this request.", "I cannot fulfill this request."],
    null,
  );
  assert.equal(declined.served.status, 422, "a decline is still a 422");
});

test("Settings sets the fallback only to a connection the Engine has, and null clears it", async () => {
  const t = await storyWorld({ runKey: "r-fb08-hhhhhh" });
  const models = t.runtime.languageModels as { resolveForRequest: typeof t.runtime.languageModels.resolveForRequest };
  const resolve = models.resolveForRequest;
  models.resolveForRequest = async (request) => {
    if (request.connectionId === "gone") throw new Error("Language model connection not found: gone");
    return resolve(request);
  };
  const routes = new Map<string, RouteHandler>();
  registerRunRoutes(
    {
      get: (path: string, handler: RouteHandler) => routes.set(`GET ${path}`, handler),
      post: (path: string, handler: RouteHandler) => routes.set(`POST ${path}`, handler),
    },
    { ...t.deps, handle: createHandle(t.runtime.logger) },
  );
  const settings = async (body: object) => {
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
      { method: "POST", url: "", body: { timeZone: "UTC", ...body }, params: { run: "r-fb08-hhhhhh" }, query: {} },
      reply,
    );
    return { status, body: (result === reply ? payload : result) as Record<string, any> };
  };
  const world = async () => (await t.store.readDoc(worldId(t.runId), normalizeWorld))!;

  const refused = await settings({ narrationFallback: "gone" });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, "bad-request");
  assert.equal((await world()).narrationFallback, undefined);

  const saved = await settings({ narrationFallback: "conn-backup" });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.world.narrationFallback, "conn-backup");
  await settings({ connections: { narration: "conn-text" } });
  assert.equal((await world()).narrationFallback, "conn-backup", "saving the connections keeps it");

  await settings({ narrationFallback: null });
  assert.equal((await world()).narrationFallback, undefined);
});

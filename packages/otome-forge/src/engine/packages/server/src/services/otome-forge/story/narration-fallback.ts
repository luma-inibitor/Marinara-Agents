// ──────────────────────────────────────────────
// Otome Forge: the narration fallback. A scene that reads as a soft refusal (fallbackReason), or that the narrator
// declined outright, is written once more on the world's `narrationFallback` connection. A fallback scene that passes
// is kept; one that does not keeps the longer of the two.
// ──────────────────────────────────────────────
import type {
  BeatFallback,
  ChapterNode,
  ForgeChoice,
  Segment,
  World,
} from "../../../../../client/src/features/otome-forge/shared/api-types.js";
import { wordCount } from "../../../../../client/src/features/otome-forge/shared/home.js";
import {
  generateJson,
  resolveConnectionId,
  type GenerateJsonRequest,
  type GenerateJsonResult,
  type GenerationDeps,
} from "../generation.js";
import { OtomeForgeError } from "../http.js";
import { BEAT_WORDS } from "../prompts.js";

/**
 * 40% of an ordinary scene (BEAT_WORDS). A node that reaches sex may run to INTIMATE_BEAT_WORDS_MAX and is told never
 * to rush, so its floor is at least an ordinary scene's; one under 260 words stopped short.
 */
export const SHORT_INTIMATE_WORDS = Math.round(BEAT_WORDS * 0.4);

const SEX_GUIDE =
  /\b(?:sex|sexual(?:ly)?|orgasms?|penetrat(?:es|ed|ing|ion)|fucks?|fucked|fucking|cum|cumming|oral(?! (?:exam|history|argument|report|tradition|test))|on the page,? explicit(?:ly)?|(?:is|are|gets|stays|turns) explicit|explicit (?:sex|scene|act|intimacy))\b/iu;

const REFUSAL =
  /\bI(?: cannot| can(?:'|’)?t| am unable to| am not able to|(?:'|’)m unable to|(?:'|’)m not able to| won(?:'|’)t be able to) (?:fulfill|fulfil|complete|comply with|help with|assist with|generate|write|create|produce|continue) (?:this|that|your|the|such|explicit|sexual)\b|\bunable to (?:generate|produce|write|create) (?:this|that|explicit|sexual|the requested)\b|\bas an AI\b|\bagainst (?:my|the) (?:guidelines|content polic(?:y|ies)|usage polic(?:y|ies)|safety guidelines)\b/iu;

const FILTERED = new Set(["content_filter", "safety", "prohibited_content"]);

type Scene = { segments: Segment[]; choices: ForgeChoice[] };

/** Under NSFW: Explicit, a node whose guide has it reach sex (the plan has no field for it; P6 leaves it to the narrator). */
export function intimateNode(world: Pick<World, "content">, node: Pick<ChapterNode, "guide">): boolean {
  return world.content.heat === "explicit" && SEX_GUIDE.test(node.guide);
}

export const sceneWords = (scene: Scene) => scene.segments.reduce((sum, segment) => sum + wordCount(segment.text), 0);

const outsideJson = (text: string) => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start < 0 || end < start ? text : `${text.slice(0, start)} ${text.slice(end + 1)}`;
};

/**
 * Why this scene reads as a soft refusal, or null. Refusal wording counts only in narration or around the JSON
 * object, never in a character's line. A small choice on the last mainline segment of a node that is not the last has
 * no next segment for its branches to return to.
 */
export function fallbackReason(
  scene: Scene,
  reply: { finishReason: string; text: string },
  where: { world: Pick<World, "content">; node: Pick<ChapterNode, "guide">; last: boolean },
): BeatFallback["reason"] | null {
  const narration = [scene.segments, ...scene.choices.flatMap((choice) => choice.options.map((o) => o.segments))]
    .flat()
    .filter((segment) => !segment.speaker && !segment.thought)
    .map((segment) => segment.text);
  if ([outsideJson(reply.text), ...narration].some((text) => REFUSAL.test(text))) return "refusal";
  if (FILTERED.has(reply.finishReason.toLowerCase())) return "filtered";
  if (!intimateNode(where.world, where.node)) return null;
  if (sceneWords(scene) < SHORT_INTIMATE_WORDS) return "short-intimate";
  const end = scene.segments.length - 1;
  if (!where.last && scene.choices.some((choice) => choice.kind === "small" && choice.at === end)) {
    return "choice-at-end";
  }
  return null;
}

export type NarratedScene<T> = GenerateJsonResult<T> & { fallback?: BeatFallback };

/** generateJson for a scene, with the fallback above; `read` turns a reply into the scene it stores. */
export async function narrateScene<T extends object>(
  deps: GenerationDeps,
  request: GenerateJsonRequest<T>,
  where: { world: World; node: ChapterNode; last: boolean; read: (value: T) => Scene },
): Promise<NarratedScene<T>> {
  const backup = where.world.narrationFallback;
  const log = (result: GenerateJsonResult<T>, note: string, fired: boolean) => {
    const scene = where.read(result.value);
    const args = [
      request.label,
      result.connectionId,
      result.model,
      sceneWords(scene),
      scene.segments.length,
      result.finishReason || "unknown",
      note,
    ];
    const line = "[otome-forge/narration] %s: %s (%s), %d words, %d segments, finish %s; %s";
    if (fired) deps.runtime.logger.warn(line, ...args);
    else deps.runtime.logger.info(line, ...args);
  };
  const onBackup = () =>
    generateJson(deps, { ...request, connectionId: backup, label: `${request.label}/fallback` }).catch(
      (error: unknown) => {
        request.signal?.throwIfAborted();
        deps.runtime.logger.warn(
          "[otome-forge/narration] %s/fallback on %s failed: %s",
          request.label,
          backup,
          error instanceof Error ? error.message : String(error),
        );
        return null;
      },
    );

  let first: GenerateJsonResult<T>;
  try {
    first = await generateJson(deps, request);
  } catch (error) {
    if (!backup || !(error instanceof OtomeForgeError) || error.code !== "declined") throw error;
    const from = resolveConnectionId(where.world, request.job) ?? "";
    if (from === backup) throw error;
    deps.runtime.logger.warn("[otome-forge/narration] %s: %s declined; fallback fired", request.label, from);
    const rescued = await onBackup();
    if (!rescued) throw error;
    log(rescued, "fallback scene kept (declined)", true);
    return { ...rescued, fallback: { reason: "declined", from, used: true } };
  }
  const reason = fallbackReason(where.read(first.value), first, where);
  if (!reason) {
    log(first, "no fallback", false);
    return first;
  }
  if (!backup || backup === first.connectionId) {
    log(first, `would fall back (${reason}), no fallback set`, false);
    return first;
  }
  log(first, `fallback fired (${reason})`, true);
  const second = await onBackup();
  if (!second) return { ...first, fallback: { reason, from: first.connectionId, used: false } };
  const again = fallbackReason(where.read(second.value), second, where);
  const used = !again || sceneWords(where.read(second.value)) > sceneWords(where.read(first.value));
  log(
    second,
    `${again ? `fallback also short (${again})` : "fallback passed"}; kept ${used ? "fallback" : "first"}`,
    true,
  );
  return { ...(used ? second : first), fallback: { reason, from: first.connectionId, used } };
}

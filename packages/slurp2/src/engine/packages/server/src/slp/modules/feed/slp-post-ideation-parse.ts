/**
 * Reading and checking the idea step's answer (`slp-post-ideation.ts`). Pure.
 *
 * Code decides what is allowed; the model only proposes. Anything outside the lists the prompt gave
 * (cast, camera, heat, saved looks, plan hooks) is a problem, never repaired: the step retries once,
 * then the post is planned as before.
 */
import { SLP_EXPLICIT_LEVELS, type SlpExplicitLevelName } from "../../../../../shared/src/slp/slp-spice.js";
import { SLURP_CAMERA_SOURCES, type SlurpCameraSource } from "./slp-camera-source.js";
import type { SlurpIdeaPlan, SlurpIdeationInput } from "./slp-post-ideation.js";

export type SlurpPostIdea = {
  /** The interest or side of them this post is about. */
  subject: string;
  /** Two or three sentences. */
  idea: string;
  /** A locked post: what subscribers get that a free post does not. */
  offer: string | null;
  /** The card or lore lines it used. */
  sources: string[];
  /** Ids from the cast list. */
  cast: string[];
  place: string;
  moment: string;
  outfit: string | null;
  wardrobeId: string | null;
  camera: SlurpCameraSource | null;
  heat: SlpExplicitLevelName;
  followsPlan: string | null;
  tags: string[];
};

/** Undressing, which a clean idea never asks for. */
const UNDRESSING =
  /\b(?:undress\w*|strip(?:s|ped|ping)?\s+(?:down|off)|striptease|stripping|lingerie|underwear|panties|bra|naked|nude|nudes|nudity|topless|bottomless|shirtless|in a towel)\b/iu;
const NEGATED = /\b(?:no|not|without|never)\s+(?:[\p{L}'-]+[\s,]+){0,2}[\p{L}'-]+/giu;

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max) : "";
const list = (value: unknown, max: number, each: number) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => text(entry, each))
    .filter(Boolean)
    .slice(0, max);
const nullable = (value: unknown, max: number) => text(value, max) || null;

/** The one JSON object in an answer, tolerating a code fence or a sentence around it. */
export function slurpIdeaJson(raw: string): Record<string, unknown> | null {
  const attempts = [raw.trim(), raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)];
  for (const candidate of attempts) {
    try {
      const value = JSON.parse(candidate) as unknown;
      const record = Array.isArray(value) && value.length === 1 ? value[0] : value;
      if (record && typeof record === "object" && !Array.isArray(record)) return record as Record<string, unknown>;
    } catch {
      // try the next shape
    }
  }
  return null;
}

const words = (value: string) =>
  (value.toLocaleLowerCase().match(/\p{L}{4,}/gu) ?? []).map((word) => word.replace(/(?<!s)s$/u, ""));
const squash = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The same subject as an earlier one: equal, or one contains the other. */
export function slurpSameSubject(left: string, right: string): boolean {
  const a = squash(left);
  const b = squash(right);
  if (!a || !b) return false;
  return a === b || (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a)));
}

/**
 * The answer, checked against the limits the prompt stated. `problems` cost the answer (one retry,
 * then the fallback); `repeats` earn one retry and are accepted after it.
 */
export function slurpCheckPostIdea(
  raw: string,
  input: Pick<SlurpIdeationInput, "cast" | "limits" | "closet" | "recent" | "steeringIdea">,
  hooks: readonly SlurpIdeaPlan[],
): { idea: SlurpPostIdea | null; problems: string[]; repeats: string[] } {
  const json = slurpIdeaJson(raw);
  if (!json) return { idea: null, problems: ["the answer was not one JSON object"], repeats: [] };
  const problems: string[] = [];
  const { limits } = input;
  const subject = text(json.subject, 80);
  const idea = text(json.idea, 900);
  const place = text(json.place, 300);
  const moment = text(json.moment, 300);
  for (const [field, value] of [
    ["subject", subject],
    ["idea", idea],
    ["place", place],
    ["moment", moment],
  ] as const) {
    if (!value) problems.push(`${field} is missing`);
  }
  const offer = nullable(json.offer, 400);
  if (limits.access === "locked" && !offer) problems.push("offer is missing: say what subscribers get");

  const castIds = [...new Set(list(json.cast, 6, 80))];
  const allowed = new Map(input.cast.map((option) => [option.id, option]));
  for (const id of castIds) if (!allowed.has(id)) problems.push(`cast id ${id} is not in the list`);

  const heatRaw = text(json.heat, 20).toLocaleLowerCase();
  const heat = (SLP_EXPLICIT_LEVELS as readonly string[]).includes(heatRaw) ? (heatRaw as SlpExplicitLevelName) : null;
  const ceiling = SLP_EXPLICIT_LEVELS.indexOf(limits.ceiling);
  if (!heat) problems.push(`heat must be one of ${SLP_EXPLICIT_LEVELS.slice(0, ceiling + 1).join(", ")}`);
  else if (SLP_EXPLICIT_LEVELS.indexOf(heat) > ceiling)
    problems.push(`heat ${heat} is above the ceiling ${limits.ceiling}`);
  if (heat === "nudity" || heat === "explicit") {
    for (const id of castIds) {
      const option = allowed.get(id);
      if (option && !option.intimate) problems.push(`${option.name} may not be in a ${heat} post`);
    }
  }

  let camera: SlurpCameraSource | null = null;
  if (limits.cameras.length) {
    const cameraRaw = text(json.camera, 20).toLocaleLowerCase();
    if (
      !(SLURP_CAMERA_SOURCES as readonly string[]).includes(cameraRaw) ||
      !limits.cameras.includes(cameraRaw as SlurpCameraSource)
    ) {
      problems.push(`camera must be one of ${limits.cameras.join(", ")}`);
    } else if (cameraRaw === "partner" && !castIds.length && !limits.companyCanHoldCamera) {
      problems.push("camera partner needs somebody in the cast to hold it");
    } else camera = cameraRaw as SlurpCameraSource;
  }

  const wardrobeId = nullable(json.wardrobeId, 80);
  const outfit = nullable(json.outfit, 300);
  if (wardrobeId) {
    const closet = heat === "nudity" || heat === "explicit" ? input.closet.intimate : input.closet.everyday;
    if (!closet.some((look) => look.id === wardrobeId))
      problems.push(`wardrobeId ${wardrobeId} is not a saved look for this heat`);
  }

  const followsPlan = nullable(json.followsPlan, 80);
  if (followsPlan && !hooks.some((plan) => plan.id === followsPlan)) {
    problems.push(
      hooks.length ? `followsPlan ${followsPlan} is not one of the plan hooks` : "followsPlan must be null this time",
    );
  }

  // A clean idea, and every locked post on a clean page, is extra access, never undressing.
  // "no nudity" is not undressing: a negated phrase is dropped before the check.
  const plain = [idea, moment, outfit ?? "", offer ?? ""].join(" ").replace(NEGATED, " ");
  if (heat === "none" && UNDRESSING.test(plain)) {
    problems.push("heat is none, so nobody undresses: no underwear, lingerie or nudity");
  }

  if (input.steeringIdea) {
    const asked = new Set(words(input.steeringIdea));
    if (asked.size && !words([subject, idea, place, moment].join(" ")).some((word) => asked.has(word))) {
      problems.push("the steering idea is not in it: this post must carry it out");
    }
  }

  const repeats = input.recent
    .slice(0, 2)
    .filter((entry) => slurpSameSubject(entry.subject, subject))
    .map((entry) => `subject "${subject}" repeats a recent post ("${entry.subject}"): pick another side of yourself`);

  if (problems.length || !heat) return { idea: null, problems, repeats };
  return {
    idea: {
      subject,
      idea,
      offer: limits.access === "locked" ? offer : null,
      sources: list(json.sources, 6, 300),
      cast: castIds,
      place,
      moment,
      outfit: wardrobeId ? null : outfit,
      wardrobeId,
      camera,
      heat,
      followsPlan,
      tags: list(json.tags, 5, 40),
    },
    problems,
    repeats,
  };
}

/** The retry turn: what was wrong, and the shape again. */
export function slurpIdeaCorrection(problems: readonly string[]): string {
  return [
    "That answer cannot be used:",
    ...problems.map((problem) => `- ${problem}`),
    "Fix these and return the whole JSON object again. JSON only.",
  ].join("\n");
}

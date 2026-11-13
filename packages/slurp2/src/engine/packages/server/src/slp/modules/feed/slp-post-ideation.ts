/**
 * Character-led post ideas: the Creator chooses what an automatic post is about.
 *
 * Pure. Before this step, code chose each post's subject from templates (a beat, an angle, a spice
 * kind), and the writer saw a small slice of the card. Now one extra model call reads the whole card,
 * the stage profile, the lore, the day, the people around them, and their recent ideas, and proposes
 * the idea. Code keeps everything that is platform logic: when the post goes up, locked or public, the
 * heat ceiling, who may be in the picture, the camera choices, and every directed post (requests,
 * commissions, campaigns, shoots, collabs). Code also checks the answer; a bad one gets one retry, then
 * the post is planned exactly as before.
 *
 * The prompt is built in `slp-post-ideation-prompt.ts` and the answer read in `slp-post-ideation-parse.ts`.
 * The feed feature wires it in (`features/feed/slp-post-ideation-service.ts`).
 */
import type { SlpDeepDetailsIdeation } from "../../../../../shared/src/slp/slp-deep-details.js";
import type { SlpExplicitLevelName } from "../../../../../shared/src/slp/slp-spice.js";
import type { SlpWardrobeLook } from "../../../../../shared/src/slp/slp-wardrobe.js";
import type { SlurpSpiceAngle } from "../creators/slp-spice.js";
import type { SlurpBeat, SlurpDayMoment } from "./slp-post-beat.js";
import type { SlurpCameraSource } from "./slp-camera-source.js";
import {
  slurpRotationHash,
  slurpTeaserPost,
  type SlurpPostVariation,
  type SlurpTeaserRate,
} from "./slp-post-variation.js";
import { buildSlurpIdeationPrompt } from "./slp-post-ideation-prompt.js";
import { slurpCheckPostIdea, slurpIdeaCorrection, type SlurpPostIdea } from "./slp-post-ideation-parse.js";

export type { SlurpPostIdea } from "./slp-post-ideation-parse.js";

/** About four characters to a token, for every cap below. */
export const SLURP_IDEATION_CHARS_PER_TOKEN = 4;
/** The whole prompt, system included. */
export const SLURP_IDEATION_MAX_TOKENS = 8000;
export const SLURP_IDEATION_CARD_TOKENS = 4000;
export const SLURP_IDEATION_LORE_TOKENS = 1000;
/** Recent posts whose ideas the step sees. */
export const SLURP_IDEATION_RECENT = 10;
/** A plan older than this is background only, never a hook. */
export const SLURP_IDEATION_PLAN_HOOK_DAYS = 7;
/** At most this many of the last `SLURP_IDEATION_PLAN_WINDOW` posts may follow a plan. */
export const SLURP_IDEATION_PLAN_CAP = 2;
export const SLURP_IDEATION_PLAN_WINDOW = 6;

/** Someone who may be in this post. Creators carry their account id; card people a `card:` id. */
export type SlurpIdeaCastOption = {
  id: string;
  name: string;
  /** How they are tied to the Creator. */
  kind: "couple" | "collab" | "rival" | "card";
  /** Up to two lines about them: a bio, or the card's relation. */
  about: string;
  accountId: string | null;
  /** May share a nude or explicit picture: their own level and hard noes allow it. */
  intimate: boolean;
};

export type SlurpIdeaPlan = { id: string; text: string; createdAt: string };

/** One earlier post's idea, newest first. Older posts without one carry their beat instead. */
export type SlurpIdeaHistoryEntry = { subject: string; idea: string; followsPlan: string | null };

export type SlurpIdeationCard = {
  description: string;
  personality: string;
  scenario: string;
  backstory: string;
  examples: string[];
};

/** Everything the idea step reads, gathered by the feed feature. */
export type SlurpIdeationInput = {
  name: string;
  /** The player's own idea for this post (Steering): the post must carry it out. */
  steeringIdea: string | null;
  card: SlurpIdeationCard | null;
  profile: {
    bio: string;
    voice: string;
    focus: string;
    push: readonly string[];
    avoid: readonly string[];
    turnOns: readonly string[];
    hardNoes: readonly string[];
    locations: string;
  };
  lore: string;
  day: SlurpDayMoment | null;
  cast: readonly SlurpIdeaCastOption[];
  recent: readonly SlurpIdeaHistoryEntry[];
  plans: readonly SlurpIdeaPlan[];
  /** What the code planner drew. The step may use, change or ignore them. */
  options: { beat: string | null; place: string | null; moment: string | null; spice: string | null };
  limits: {
    access: "public" | "locked";
    teaser: boolean;
    ceiling: SlpExplicitLevelName;
    /** Empty when the post has no picture: then the camera is not asked for. */
    cameras: readonly SlurpCameraSource[];
    suggestedCamera: SlurpCameraSource | null;
    /** Somebody willing to hold the camera is around even when the cast is empty. */
    companyCanHoldCamera: boolean;
  };
  /** The saved looks a picture at each heat may use. */
  closet: { everyday: readonly SlpWardrobeLook[]; intimate: readonly SlpWardrobeLook[] };
  at: Date;
};

const LEVEL_INDEX = (level: string) => ["none", "suggestive", "nudity", "explicit"].indexOf(level);
export const slurpIdeaLevelIsBare = (level: string) => LEVEL_INDEX(level) >= 2;

// --- Locked or public ----------------------------------------------------------------------------

/** A fixed draw in [0, 1) per Creator and post. */
function unit(creatorAccountId: string, sequence: number): number {
  return slurpRotationHash(`${creatorAccountId}:lockedShare:${sequence}`) / 2 ** 32;
}

/**
 * Whether an automatic post goes out free. With character-led ideas on, `lockedShare` of posts are
 * locked. Teaser slots (`slurpTeaserPost`) stay free first, so the teaser rate still means something;
 * the other slots make up the rest of the free share. Off, this is exactly the teaser rotation.
 */
export function slurpAutomaticPostFree(
  creatorAccountId: string,
  sequence: number,
  settings: { teaserRate: SlurpTeaserRate; characterLedIdeas?: boolean; lockedShare?: number },
): boolean {
  const teaserSlot = slurpTeaserPost(creatorAccountId, sequence, settings.teaserRate);
  if (!settings.characterLedIdeas) return teaserSlot;
  const free = 1 - Math.min(1, Math.max(0, settings.lockedShare ?? 0.5));
  // The share of slots that are teaser slots: every tenth slot is one per entry in the rotation.
  const teaserShare =
    Array.from({ length: 10 }, (_, step) => slurpTeaserPost(creatorAccountId, step, settings.teaserRate)).filter(
      Boolean,
    ).length / 10;
  const chance = teaserSlot
    ? Math.min(1, free / Math.max(teaserShare, Number.EPSILON))
    : Math.max(0, (free - teaserShare) / Math.max(1 - teaserShare, Number.EPSILON));
  return unit(creatorAccountId, sequence) < chance;
}

// --- When the step runs ----------------------------------------------------------------------------

const DIRECTED_PURPOSES: Record<string, string> = {
  poll_answer: "answers a Story poll",
  answer_fans: "answers a subscriber request",
  tease: "teases a drop",
  storyline: "carries a storyline",
  promote: "carries a collab, brand deal or couple post",
};
const DIRECTED_ANCHORS: Record<string, string> = {
  arc: "carries an arc chapter",
  collab: "carries a collab",
  sponsor: "carries a brand deal",
  rival: "carries a rivalry",
  couple: "carries a couple moment",
  drama: "carries a drama beat",
  trend: "joins a trend",
};

/**
 * Why this post keeps today's planner, or null when the Creator chooses the idea. Directed posts
 * (the player's direction, requests, commissions, campaign stages, shoots, projects, collabs, deals,
 * rivalries, trends) are platform logic and keep their path.
 */
export function slurpIdeationSkip(post: {
  enabled: boolean;
  directed: boolean;
  hasVariation: boolean;
  project: boolean;
  shoot: boolean;
  reusedPicture: boolean;
  intent: string | null | undefined;
  purpose: { kind: string; teasePostId?: string } | null | undefined;
  /** A drop that delivers what its tease hinted at. */
  teasedKind: string | null | undefined;
  beat: Pick<SlurpBeat, "anchorKind" | "tie" | "trend" | "sharedId"> | null | undefined;
}): string | null {
  if (!post.enabled) return "off";
  if (post.directed || !post.hasVariation) return "the player directed this post";
  if (post.project) return "it continues a project";
  if (post.shoot) return "it continues an earlier shoot";
  if (post.reusedPicture) return "it reuses an earlier picture";
  if (post.intent === "request" || post.intent === "callback") return `its purpose is fixed (${post.intent})`;
  const purpose = post.purpose?.kind ? DIRECTED_PURPOSES[post.purpose.kind] : undefined;
  if (purpose) return `it ${purpose}`;
  if (post.purpose?.kind === "drop" && (post.purpose.teasePostId || post.teasedKind))
    return "it delivers a teased drop";
  const beat = post.beat;
  if (beat?.tie) return "it carries a collab, brand deal, rivalry or couple moment";
  if (beat?.trend) return "it joins a trend";
  if (beat?.sharedId?.startsWith("poll:")) return "it answers a Story poll";
  const anchor = beat ? DIRECTED_ANCHORS[beat.anchorKind] : undefined;
  return anchor ? `it ${anchor}` : null;
}

// --- Plans -----------------------------------------------------------------------------------------

/**
 * Which of the Creator's own plans may be this post's hook. At most `SLURP_IDEATION_PLAN_CAP` of the
 * last `SLURP_IDEATION_PLAN_WINDOW` posts follow a plan; past that, plans are background only. A plan
 * older than `SLURP_IDEATION_PLAN_HOOK_DAYS` days, or one a recent post already followed, is never a
 * hook.
 */
export function slurpIdeationPlans(
  plans: readonly SlurpIdeaPlan[],
  recent: readonly SlurpIdeaHistoryEntry[],
  at: Date,
): { hooks: SlurpIdeaPlan[]; background: SlurpIdeaPlan[]; mode: "hook" | "background" | "none" } {
  if (!plans.length) return { hooks: [], background: [], mode: "none" };
  const followed = recent.slice(0, SLURP_IDEATION_PLAN_WINDOW).filter((entry) => entry.followsPlan);
  const capped = followed.length >= SLURP_IDEATION_PLAN_CAP;
  const used = new Set(recent.map((entry) => entry.followsPlan).filter(Boolean));
  const fresh = (plan: SlurpIdeaPlan) => {
    const created = Date.parse(plan.createdAt);
    return Number.isFinite(created) && at.getTime() - created <= SLURP_IDEATION_PLAN_HOOK_DAYS * 86_400_000;
  };
  const hooks = capped ? [] : plans.filter((plan) => fresh(plan) && !used.has(plan.id));
  const hookIds = new Set(hooks.map((plan) => plan.id));
  return {
    hooks,
    background: plans.filter((plan) => !hookIds.has(plan.id)),
    mode: hooks.length ? "hook" : "background",
  };
}

// --- The call ------------------------------------------------------------------------------------

export type SlurpIdeationMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * One idea for one post: the call, the checks, and at most one retry. `complete` makes the model
 * call and returns its text. A null idea means the post is planned as before; the record says why.
 */
export async function runSlurpPostIdeation(
  input: SlurpIdeationInput,
  complete: (messages: SlurpIdeationMessage[]) => Promise<string>,
): Promise<{ idea: SlurpPostIdea | null; record: SlpDeepDetailsIdeation }> {
  const plans = slurpIdeationPlans(input.plans, input.recent, input.at);
  const prompt = buildSlurpIdeationPrompt(input, plans);
  const record: SlpDeepDetailsIdeation = {
    status: "fallback",
    reason: null,
    prompt,
    attempts: [],
    idea: null,
    plans: plans.mode,
  };
  let messages: SlurpIdeationMessage[] = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let raw: string;
    try {
      raw = await complete(messages);
    } catch (error) {
      record.reason = `the model call failed: ${error instanceof Error ? error.message : String(error)}`;
      return { idea: null, record };
    }
    const checked = slurpCheckPostIdea(raw, input, plans.hooks);
    record.attempts.push({ raw, problems: [...checked.problems, ...checked.repeats] });
    // A repeated subject earns the retry; if the retry repeats too, the idea stands.
    if (checked.idea && !checked.problems.length && (!checked.repeats.length || attempt === 2)) {
      record.status = "used";
      record.idea = checked.idea;
      return { idea: checked.idea, record };
    }
    if (attempt === 2) {
      record.reason = `still invalid after one retry: ${checked.problems.join("; ")}`;
      return { idea: null, record };
    }
    messages = [
      ...messages,
      { role: "assistant", content: raw },
      { role: "user", content: slurpIdeaCorrection([...checked.problems, ...checked.repeats]) },
    ];
  }
  return { idea: null, record };
}

/** The record for a post that kept today's planner on purpose. */
export function slurpSkippedIdeation(reason: string): SlpDeepDetailsIdeation {
  return { status: "skipped", reason, prompt: null, attempts: [], idea: null, plans: "none" };
}

// --- Applying the idea ---------------------------------------------------------------------------

const HEAT_WORDS: Record<SlpExplicitLevelName, string> = {
  none: "clean, nothing sexual",
  suggestive: "flirty and suggestive, clothes stay on",
  nudity: "nudity is fine, no sex",
  explicit: "explicit",
};

const sentence = (value: string) => {
  const text = value.trim();
  return !text ? "" : /[.!?…]$/u.test(text) ? text : `${text}.`;
};

/** The idea as the writer's "What happens" line: the idea, what subscribers get, the moment, the clothes, the heat. */
export function slurpIdeaLine(idea: SlurpPostIdea, looks: readonly SlpWardrobeLook[]): string {
  const look = idea.wardrobeId ? looks.find((entry) => entry.id === idea.wardrobeId) : undefined;
  return [
    sentence(idea.idea),
    idea.offer ? sentence(`For subscribers: ${idea.offer}`) : "",
    sentence(`Moment: ${idea.moment}`),
    look
      ? `Wear your saved look "${look.name}" (wardrobe ID ${look.id}).`
      : idea.outfit
        ? sentence(`Wearing: ${idea.outfit}`)
        : "",
    `Heat: ${HEAT_WORDS[idea.heat]}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

const CAST_RELATION: Record<SlurpIdeaCastOption["kind"], string> = {
  couple: "their partner",
  collab: "a fellow Creator",
  rival: "a rival Creator",
  card: "",
};

/**
 * The post as the idea plans it: the beat the writer reads, the scene the picture falls back on, the
 * heat, the camera, and what is stamped on the post for later ideas. A nude or explicit idea with an
 * intimate cast member is a partner scene, so the picture draws them.
 */
export function slurpApplyPostIdea(input: {
  idea: SlurpPostIdea;
  planned: SlurpBeat | null;
  cast: readonly SlurpIdeaCastOption[];
  variation: SlurpPostVariation;
  looks: readonly SlpWardrobeLook[];
  camera: SlurpCameraSource | null;
}): {
  beat: SlurpBeat;
  angle: SlurpSpiceAngle | null;
  variation: SlurpPostVariation;
  postLevel: SlpExplicitLevelName;
  camera: SlurpCameraSource | null;
  metadata: Record<string, unknown>;
} {
  const { idea, planned } = input;
  const cast = idea.cast.flatMap((id) => input.cast.filter((option) => option.id === id));
  const names = cast.map((option) =>
    option.kind === "card" && option.about ? `${option.name} (${option.about})` : option.name,
  );
  const nudgeId = planned?.nudgeId;
  const beat: SlurpBeat = {
    type: planned?.type ?? "routine_twist",
    // The player's idea may change their life as it says; anything else is a moment, like a card beat.
    anchorKind: nudgeId ? "steer" : planned && planned.anchorKind !== "steer" ? planned.anchorKind : "life",
    anchor: idea.subject,
    line: slurpIdeaLine(idea, input.looks),
    cast: names,
    castIds: cast.flatMap((option) => (option.accountId ? [option.accountId] : [])),
    place: idea.place,
    ...(planned?.heatFloor !== undefined ? { heatFloor: planned.heatFloor } : {}),
    ...(nudgeId ? { nudgeId } : {}),
  };
  const partner = slurpIdeaLevelIsBare(idea.heat) ? cast.find((option) => option.intimate) : undefined;
  const angle: SlurpSpiceAngle | null = partner
    ? {
        kind: "idea",
        label: idea.subject,
        line: "",
        moment: idea.moment,
        partner: {
          kind: partner.kind === "collab" ? "collab" : "couple",
          name: partner.name,
          company: `${partner.name}, ${CAST_RELATION[partner.kind] || partner.about || "their partner"}`,
        },
        taste: null,
      }
    : null;
  return {
    beat,
    angle,
    variation: {
      ...input.variation,
      place: idea.place,
      moment: idea.moment,
      ...(names.length ? { company: `with ${names.join(", ")}`, companyCanHoldCamera: true } : {}),
    },
    postLevel: idea.heat,
    camera: idea.camera ?? input.camera,
    metadata: {
      slurpIdea: {
        subject: idea.subject,
        idea: idea.idea.slice(0, 240),
        followsPlan: idea.followsPlan,
        tags: idea.tags,
      },
    },
  };
}

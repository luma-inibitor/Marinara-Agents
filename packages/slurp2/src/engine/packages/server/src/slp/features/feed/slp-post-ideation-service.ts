/**
 * Character-led post ideas, wired into post generation. The rules live in
 * `modules/feed/slp-post-ideation.ts`.
 *
 * `planSlurpPostIdea` stands in for `planSlurpPostSpice` at the one call site in
 * `slp-generation-service.ts`. It runs the spice planner exactly as before, then, when the setting is on
 * and the post is not directed, lets the Creator choose the idea. It returns what the generator reads
 * after that point: the beat, the spice angle and level, the variation, the camera, the closet, the
 * picture's level, the post metadata, and the planner block of Deep details. With the setting off, a
 * directed post, or an idea that fails its checks, every value is what today's planner produced.
 */
import type { APIProvider } from "@marinara-engine/shared";
import type { DB } from "../../../db/connection.js";
import { logger } from "../../../lib/logger.js";
import { resolveStoredChatOptions } from "../../../services/generation/generation-parameters.js";
import { clampGenerationMaxOutputTokens } from "../../../services/generation/output-token-limits.js";
import {
  completeSlurpWithHost,
  createSlurpPostProvider,
  slpRequireBackgroundIdle,
} from "../../base/host/slp-generation-integrations.js";
import { requireModelAnswer } from "../../base/model/slp-model-answer.js";
import { slpSamplingOptions } from "../../base/prompting/slp-sampling-options.js";
import type { SlpDeepDetailsIdeation } from "../../../../../shared/src/slp/slp-deep-details.js";
import type { SlpAccount } from "../../../../../shared/src/slp/slp-social.types.js";
import type { SlpWardrobeLook } from "../../../../../shared/src/slp/slp-wardrobe.js";
import { listSlurpContinuityFor } from "../../data/continuity/slp-continuity-storage.js";
import { readSlurpWorldLens } from "../../data/creators/slp-canon-anchor-storage.js";
import { resolveSlurpSpiceCreator } from "../../data/creators/slp-flavour-source.js";
import { readSlurpIdeationCard } from "../../data/creators/slp-ideation-card.js";
import { slurpSpicyCollabNames } from "../../data/creators/slp-spice-storage.js";
import { readSlurpCreatorSteering } from "../../data/creators/slp-steering-storage.js";
import { listSlurpIdeaHistory } from "../../data/feed/slp-ideation-history.js";
import { resolveSlurpLoreContext } from "../../data/host/slp-lore-context.js";
import { readSlurpCreatorTiesDocument } from "../../data/projects/slp-creator-ties-storage.js";
import { createSlurpStorage } from "../../data/slp-storage.js";
import { createConnectionsStorage } from "../../../services/storage/connections.storage.js";
import { SLURP_PARTNER_RELATION } from "../../modules/creators/slp-spice.js";
import {
  slurpCameraSourceInstruction,
  slurpPermittedCameraSources,
  type SlurpCameraSource,
} from "../../modules/feed/slp-camera-source.js";
import type { SlurpDayMoment } from "../../modules/feed/slp-post-beat.js";
import {
  runSlurpPostIdeation,
  slurpApplyPostIdea,
  slurpIdeaLevelIsBare,
  slurpIdeationSkip,
  slurpSkippedIdeation,
  SLURP_IDEATION_RECENT,
  type SlurpIdeaCastOption,
  type SlurpIdeaPlan,
  type SlurpIdeationInput,
} from "../../modules/feed/slp-post-ideation.js";
import { slurpPostSexualLevel } from "../../modules/feed/slp-post-guidance.js";
import type { SlurpPurposePlan } from "../../modules/feed/slp-post-purpose.js";
import { slurpPostCloset } from "../../modules/feed/slp-wardrobe-selection.js";
import { slurpCollabPartners } from "../../modules/projects/slp-project.js";
import { slurpRivalryActive, slurpWorkingPartnerIds } from "../../modules/projects/slp-creator-ties.js";
import { slurpConditionCloset } from "../../modules/storylines/slp-story-state.js";
import type { loadSlurpStoryState } from "../storylines/slp-storylines-contract.js";
import { readSlurpCouplePartner } from "../projects/slp-projects-contract.js";
import type { SlpCreatorPostGenerationInput } from "./slp-generation-contract.js";
import { planSlurpPostSpice } from "./slp-post-spice.js";

type SpiceInput = Parameters<typeof planSlurpPostSpice>[1];

/** What the generator has decided by the time the spice is planned, and the idea step needs. */
export type SlurpPostIdeaContext = {
  input: Pick<SlpCreatorPostGenerationInput, "connection" | "admissionMode">;
  /** The camera the rotation drew; null when the post has no picture. */
  camera: SlurpCameraSource | null;
  purpose: SlurpPurposePlan;
  shoot: unknown;
  project: unknown;
  reusedMedia: unknown;
  looks: readonly SlpWardrobeLook[];
  story: Awaited<ReturnType<typeof loadSlurpStoryState>>;
  beatRun: { day: SlurpDayMoment | null };
  /** The writer plans the scene, so the post has a picture and a closet. */
  scene: boolean;
};

const IDEATION_MAX_OUTPUT_TOKENS = 1500;
const CAST_MAX = 8;
const ABOUT_MAX = 200;

/** People who may be in this post: a couple partner, collab partners, rivals, and the card's own people. */
async function readIdeaCast(
  db: DB,
  account: Pick<SlpAccount, "id">,
  collabs: SpiceInput["collabs"],
  people: readonly { name: string; relation: string }[],
): Promise<SlurpIdeaCastOption[]> {
  const [{ ties }, couple] = await Promise.all([
    readSlurpCreatorTiesDocument(db),
    readSlurpCouplePartner(db, account.id),
  ]);
  const other = (a: string, b: string) => (a === account.id ? b : b === account.id ? a : null);
  const paired = slurpCollabPartners(collabs, account.id).map((entry) => entry.partnerId);
  const ids: [string, SlurpIdeaCastOption["kind"]][] = [
    ...(couple.partnerId ? [[couple.partnerId, "couple"] as [string, "couple"]] : []),
    ...slurpWorkingPartnerIds(ties, account.id, paired).map((id): [string, "collab"] => [id, "collab"]),
    ...ties.rivalries.filter(slurpRivalryActive).flatMap((rivalry) => {
      const id = other(rivalry.fromId, rivalry.toId);
      return id ? [[id, "rival"] as [string, "rival"]] : [];
    }),
  ];
  const seen = new Set<string>();
  const unique = ids.filter(([id]) => id !== account.id && !seen.has(id) && Boolean(seen.add(id))).slice(0, CAST_MAX);
  const noodle = createSlurpStorage(db);
  const intimate = new Set(
    await slurpSpicyCollabNames(
      db,
      unique.filter(([, kind]) => kind !== "rival").map(([id]) => id),
    ).catch(() => [] as string[]),
  );
  const creators = await Promise.all(
    unique.map(async ([id, kind]): Promise<SlurpIdeaCastOption | null> => {
      const partner = await noodle.getNoodlerAccountById(id).catch(() => null);
      if (!partner?.displayName) return null;
      return {
        id,
        name: partner.displayName,
        kind,
        about: (partner.bio ?? "").replace(/\s+/gu, " ").trim().slice(0, ABOUT_MAX),
        accountId: id,
        intimate: kind !== "rival" && intimate.has(partner.displayName),
      };
    }),
  );
  const card = people.slice(0, CAST_MAX).map((person, index): SlurpIdeaCastOption => ({
    id: `card:${index + 1}`,
    name: person.name,
    kind: "card",
    about: person.relation,
    accountId: null,
    // A card partner, as the spice planner reads one; a Creator in a couple with another Creator is taken.
    intimate: !couple.inCouple && SLURP_PARTNER_RELATION.test(person.relation),
  }));
  return [...creators.filter((entry): entry is SlurpIdeaCastOption => entry !== null), ...card];
}

/** The Creator's own plans (continuity), newest first. */
async function readIdeaPlans(db: DB, accountId: string, access: string, at: Date): Promise<SlurpIdeaPlan[]> {
  const { facts } = await listSlurpContinuityFor(db, accountId, access === "locked" ? "locked_post" : "public_post", {
    at,
    limit: 50,
  });
  return facts
    .filter((fact) => fact.factType === "plan")
    .slice(0, 6)
    .map((fact) => ({ id: fact.id, text: fact.text, createdAt: fact.createdAt }));
}

/** One model call on the Creator's generation connection, admitted like the beats planner's readings. */
function ideationCall(db: DB, context: SlurpPostIdeaContext["input"]) {
  return async (messages: Parameters<typeof completeSlurpWithHost>[1]) => {
    const { connection } = context;
    // An automatic post's call runs only while background work may use the connection and books
    // nothing, as `completeSlurpBeatJson` does; a player's post books it as their own work.
    const background = context.admissionMode?.kind === "background";
    if (background) slpRequireBackgroundIdle(connection.id);
    const provider = createSlurpPostProvider({
      connection,
      fallbackConnection: await createConnectionsStorage(db).getFallbackForMain(),
      admissionMode: background ? { kind: "none" } : { kind: "foreground" },
    });
    const response = await completeSlurpWithHost(provider, messages, {
      model: connection.model,
      ...slpSamplingOptions(
        resolveStoredChatOptions(connection.defaultParameters, connection.provider, connection.model),
        { temperature: 0.9, topP: 0.95 },
      ),
      maxTokens: clampGenerationMaxOutputTokens({
        provider: connection.provider as APIProvider,
        model: connection.model,
        maxTokens: IDEATION_MAX_OUTPUT_TOKENS,
        maxTokensOverride: connection.maxTokensOverride,
      }),
      stream: false,
    });
    return requireModelAnswer(response.content ?? "", "a post idea");
  };
}

/** The spice plan, then, when the Creator chooses the idea, the post that idea plans. */
export async function planSlurpPostIdea(
  db: DB,
  spiceInput: Omit<SpiceInput, "teasedKind" | "account"> & { account: SlpAccount; idea: SlurpPostIdeaContext },
) {
  const { idea: context, ...rest } = spiceInput;
  const { account, access, intent, explicitLevel } = rest;
  const spiced = await planSlurpPostSpice(db, { ...rest, teasedKind: context.purpose.spiceKind });
  const settings = await createSlurpStorage(db).getSettings();
  const closet = slurpConditionCloset(context.looks, context.story.state.wardrobe);
  const closetAt = (level: SpiceInput["explicitLevel"]) =>
    slurpPostCloset(closet, { level, access, intent, scene: context.scene });
  const today = closetAt(explicitLevel);
  const planned = {
    ...spiced,
    camera: context.camera,
    cameraLine: context.camera ? slurpCameraSourceInstruction(context.camera) : undefined,
    wardrobeLooks: today.looks,
    bare: today.bare,
    pictureLevel: explicitLevel,
    planner: { mode: settings.postPlanner } as { mode: typeof settings.postPlanner; ideation?: SlpDeepDetailsIdeation },
  };
  const skip = slurpIdeationSkip({
    enabled: settings.characterLedIdeas,
    directed: rest.directed,
    hasVariation: Boolean(rest.variation),
    project: Boolean(context.project),
    shoot: Boolean(context.shoot),
    reusedPicture: Boolean(context.reusedMedia),
    intent,
    purpose: context.purpose.purpose,
    teasedKind: context.purpose.spiceKind,
    beat: rest.beat,
  });
  if (skip === "off") return planned;
  if (skip || !rest.variation) {
    return { ...planned, planner: { ...planned.planner, ideation: slurpSkippedIdeation(skip ?? "no variation") } };
  }
  const variation = rest.variation;
  try {
    const at = rest.at ?? new Date();
    const [steering, spiceRead, card, recent, plans, screens] = await Promise.all([
      readSlurpCreatorSteering(db, account.id),
      resolveSlurpSpiceCreator(db, { account, source: rest.source, disclosureMode: rest.disclosureMode }),
      readSlurpIdeationCard(db, rest.source, rest.disclosureMode).catch(() => null),
      listSlurpIdeaHistory(db, account.id, SLURP_IDEATION_RECENT).catch(() => []),
      readIdeaPlans(db, account.id, access, at).catch(() => []),
      readSlurpWorldLens(db, account.id).then((lens) => !lens),
    ]);
    const cast = await readIdeaCast(db, account, rest.collabs, spiceRead.creator.anchors?.people ?? []).catch(
      () => [] as SlurpIdeaCastOption[],
    );
    const cardText = card ? [card.description, card.personality, card.scenario, card.backstory].join("\n") : "";
    const lore = (
      await resolveSlurpLoreContext(db, { settings, texts: [], sourceCharacterContext: cardText, source: rest.source })
    ).text;
    // The player's idea is this post's when the planner gave it this slot (its beat carries the id).
    const nudge = rest.beat?.nudgeId ? steering.nudges.find((entry) => entry.id === rest.beat?.nudgeId) : undefined;
    // The Creator's own level after access and intent, not the level the planner drew for this post.
    const ceiling = slurpPostSexualLevel({ level: rest.dialLevel, access, intent });
    const input: SlurpIdeationInput = {
      name: account.displayName,
      steeringIdea: nudge?.text ?? null,
      card,
      profile: {
        bio: account.bio ?? "",
        voice: account.settings.privacy.stagePersonality ?? "",
        focus: steering.focus,
        push: steering.push,
        avoid: steering.avoid,
        turnOns: spiceRead.creator.turnOns,
        hardNoes: [...new Set([...spiceRead.creator.hardNoes, ...spiceRead.spice.spice.never])],
        locations: account.settings.stage?.locations ?? "",
      },
      lore,
      day: context.beatRun.day,
      cast,
      recent,
      plans,
      options: {
        beat: rest.beat && !nudge ? rest.beat.line : null,
        place: variation.place,
        moment: variation.moment,
        spice: spiced.angle?.line ?? null,
      },
      limits: {
        access,
        teaser: rest.teaser,
        ceiling,
        cameras: context.camera
          ? slurpPermittedCameraSources({
              companyCanHoldCamera: variation.companyCanHoldCamera || cast.length > 0,
              screens,
            })
          : [],
        suggestedCamera: context.camera,
        companyCanHoldCamera: variation.companyCanHoldCamera,
      },
      closet: {
        everyday: closetAt("none").looks,
        intimate: slurpIdeaLevelIsBare(ceiling) ? closetAt(ceiling).looks : [],
      },
      at,
    };
    const { idea, record } = await runSlurpPostIdeation(input, ideationCall(db, context.input));
    if (!idea) return { ...planned, planner: { ...planned.planner, ideation: record } };
    const applied = slurpApplyPostIdea({
      idea,
      planned: rest.beat,
      cast,
      variation,
      looks: [...input.closet.everyday, ...input.closet.intimate],
      camera: context.camera,
    });
    const chosen = closetAt(idea.heat);
    return {
      ...spiced,
      ...applied,
      cameraLine: applied.camera ? slurpCameraSourceInstruction(applied.camera) : undefined,
      wardrobeLooks: chosen.looks,
      bare: chosen.bare,
      pictureLevel: idea.heat,
      planner: { ...planned.planner, ideation: record },
    };
  } catch (error) {
    // A post never fails over its idea: it is planned as before, and Deep details says why.
    logger.warn(error, "[slurp] The idea step failed; the post is planned as before");
    const reason = `the idea step failed: ${error instanceof Error ? error.message : String(error)}`;
    return {
      ...planned,
      planner: { ...planned.planner, ideation: { ...slurpSkippedIdeation(reason), status: "fallback" as const } },
    };
  }
}

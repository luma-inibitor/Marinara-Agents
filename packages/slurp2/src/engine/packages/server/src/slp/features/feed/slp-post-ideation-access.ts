import type { createSlurpStorage } from "../../data/slp-storage.js";
import { slurpAutomaticPostFree } from "../../modules/feed/slp-post-ideation.js";
import { resolveSlurpAutomaticPostAccess as resolveSlurpTeaserAccess } from "./slp-automatic-post-access.js";

/**
 * Access for an automatic post. With character-led ideas off, the teaser rotation decides, exactly as
 * before (`slp-automatic-post-access.ts`). On, `lockedShare` of automatic posts are locked, and teaser
 * slots are the first to go out free. A player-chosen access never passes through here.
 */
export async function resolveSlurpAutomaticPostAccess(
  noodle: Pick<ReturnType<typeof createSlurpStorage>, "peekNoodlerPostSequence" | "getSettings">,
  accountId: string,
): Promise<"public" | "locked"> {
  const settings = await noodle.getSettings();
  if (!settings.characterLedIdeas) return resolveSlurpTeaserAccess(noodle, accountId);
  const sequence = await noodle.peekNoodlerPostSequence(accountId);
  return slurpAutomaticPostFree(accountId, sequence, settings) ? "public" : "locked";
}

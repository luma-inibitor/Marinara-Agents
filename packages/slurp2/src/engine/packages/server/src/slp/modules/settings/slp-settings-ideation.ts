import { z } from "zod";

/**
 * The character-led ideas settings (`modules/feed/slp-post-ideation.ts`). Kept apart from
 * `slp-settings.ts` and spread into its schema and defaults, so the feature stays one module.
 *
 * - `characterLedIdeas`: an extra model call lets the Creator choose what an automatic post is about.
 *   Off, posts are planned exactly as before.
 * - `lockedShare`: the share of automatic posts that go out locked while the setting above is on.
 */
export const slurpIdeationSettingsShape = {
  characterLedIdeas: z.boolean(),
  lockedShare: z.number().min(0).max(1),
};

export const SLURP_IDEATION_SETTINGS_DEFAULTS = { characterLedIdeas: true, lockedShare: 0.5 };

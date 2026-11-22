// ──────────────────────────────────────────────
// Otome Hearth: the personality quiz (#2174), what the server and the client share
// ──────────────────────────────────────────────
// While a chapter is planned (outside the wait that plans an arc), the player may answer statements on a 1–5 scale,
// from strongly disagree to strongly agree, and then see how each love interest answered the same statement. Their
// answers are written from their bibles by the Planning connection (S/minigames/quiz.ts) and are never sent with any
// other model call. How well the player and a love interest match is counted here, with no model call. Statements about
// who leads and who yields come in pairs, one per side, written as pairs (the starters' QUIZ_PAIRS, a refill's [lead N]
// and [yield N] lines), and match across the pair: the player's answer on one half against the love interest's on the
// other. Statements refills wrote before pairs existed are read by their wording (quizPowerOf) and match against the love
// interest's answers on the other side as a whole.
import type { LiId } from "./api-types";

export const QUIZ_SCALE = [1, 2, 3, 4, 5] as const;
export type QuizScore = (typeof QUIZ_SCALE)[number];

export const isQuizScore = (value: unknown): value is QuizScore =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;

/** How many new statements one refill writes, once the player has answered every one they can see. */
export const QUIZ_REFILL = 50;

/** A statement as the quiz serves it. */
export interface QuizStatementView {
  id: string;
  text: string;
  /** The player's own answer, once given; the first answer is final. */
  answer?: QuizScore;
  /** Each current love interest's answer, once written. */
  scores: Partial<Record<LiId, QuizScore>>;
  power?: QuizPowerView;
}

/**
 * GET /runs/:run/quiz and POST /runs/:run/quiz/answer: the statements the player may see (an 18+ one only while Heat is
 * NSFW), split into those still open (in the order they are asked) and those answered, and what is being written.
 */
export interface QuizView {
  open: QuizStatementView[];
  answered: QuizStatementView[];
  /** New statements are being written: the player answered every one they can see. */
  refilling: boolean;
  /** Love interests' answers that are missing (an older story, someone new, Heat raised) are being written. */
  scoring: boolean;
}

export type QuizSide = "lead" | "yield";

/** One half of a power pair: its side, and the other half's statement id. */
export interface QuizPair {
  side: QuizSide;
  pair: string;
}

/** A statement's place on the power axis as served: a pair's half, or an older statement read by its wording. */
export interface QuizPowerView {
  side: QuizSide | "versus";
  pair?: string;
}

/**
 * An older statement's place on the power axis, by its wording. `lead` and `yield` speak for one side only ("I like
 * pinning my partner down", "I like having my wrists held down"); `versus` weighs one side against the other ("I'd rather
 * lead than follow").
 */
export type QuizPower = QuizSide | "versus";

const LEAD: readonly RegExp[] = [
  /\b(?:pin(?:ning)?|tying|tie|collar(?:ing)?|spank(?:ing)?|gag(?:ging)?|restrain(?:ing)?|cuff(?:ing)?|bind(?:ing)?|chok(?:e|ing)|punish(?:ing)?|order(?:ing)?|command(?:ing)?|boss(?:ing)?|dominat(?:e|ing)|train(?:ing)?|control(?:ling)?|silenc(?:e|ing)|arrang(?:e|ing)|us(?:e|ing))\s+(?:my|a)\s+partner\b/iu,
  /\bcollar on (?:my|a) partner\b/iu,
  /\bmak(?:e|ing) (?:my|a) partner (?:beg|wait|obey|kneel|ask|keep|stay|earn|count|crawl|plead|serve)\b/iu,
  /\bdecid(?:e|es|ing) when (?:my|a) partner\b|\b(?:being|I'm|I am) the one who decides\b/iu,
  /\buntil I (?:allow|say|let)\b|\bwhen I allow\b/iu,
  /\bobeys? me\b|\bpartner who obeys\b/iu,
  /\bgiv(?:e|ing) (?:(?:my|a) partner )?(?:strict |clear |step-by-step )?(?:rules|orders|instructions|commands)\b/iu,
  /\bput in (?:their|his|her) place\b/iu,
  /\bpartner silenced\b/iu,
  /\bunder my (?:hands|control|command)\b/iu,
  /\bpartner takes? pain\b/iu,
  /\buntil they give in\b/iu,
  /\bI (?:like|love|enjoy|prefer|want) (?:to be|being) (?:in control|in charge|dominant|the dominant one)\b/iu,
  /\btak(?:e|ing) (?:charge|control) (?:in bed|of (?:my|a) partner)\b/iu,
];

const YIELD: readonly RegExp[] = [
  /\bbe(?:ing)? (?:tied|spanked|pinned|collared|gagged|restrained|cuffed|bound|choked|punished|dominated|controlled|bossed around|ordered around|commanded|used|owned|held down|pushed)\b/iu,
  /\bbe(?:ing)? told (?:what|how|to)\b/iu,
  /\bbe(?:ing)? made to\b/iu,
  /\bhav(?:e|ing) my (?:wrists|hands|arms) (?:held|pinned|tied|bound)\b/iu,
  /\bhand (?:around|on) my (?:throat|neck)\b|\bhand on the back of my head\b/iu,
  /\bon my knees\b/iu,
  /\b(?:someone's|a partner's|my partner's) pet\b/iu,
  /\bgiv(?:e|ing) up control\b|\bhand(?:ing)? over control\b/iu,
  /\bbeg(?:ging)? for\b/iu,
  /\blet (?:my|a) partner decide\b/iu,
  /\bI (?:like|love|enjoy|want) (?:to )?obey(?:ing)?\b|\bobey(?:ing)? (?:my|a) partner\b/iu,
  /\b(?:to be|being) (?:submissive|obedient)\b/iu,
];

const LEADS_SIDE = /\b(?:lead|protects|in charge|give orders|take care of|look after|decide)\b/iu;
const YIELDS_SIDE =
  /\b(?:follow|(?:am|is|be|being) protected|be led|take orders|(?:be|being) taken care of|(?:be|being) looked after)\b/iu;
const FIRST_PERSON = /\b(?:I|I'd|I'm|me|my)\b|^being\b/iu;
const NEGATED = /n't\b|\b(?:not|never|no|nor|hate|dislike)\b/iu;
const EITHER_SIDE = /\b(?:switch|switching|one of us|either|both|giving or receiving|or wearing|or being)\b/iu;

/**
 * An older statement's place on the power axis, by its wording; null for anything else, negated, about either side, or
 * not about the speaker. Only for statements written before pairs existed: it never tags a pair's half.
 */
export function quizPowerOf(text: string): QuizPower | null {
  const line = text.replace(/[’‘]/gu, "'").trim();
  if (!FIRST_PERSON.test(line) || NEGATED.test(line) || EITHER_SIDE.test(line)) return null;
  const sides = /\brather\b(.*?)\bthan\b(.*)$/iu.exec(line);
  if (sides) {
    const [, first = "", second = ""] = sides;
    const opposed =
      (LEADS_SIDE.test(first) && YIELDS_SIDE.test(second)) || (YIELDS_SIDE.test(first) && LEADS_SIDE.test(second));
    return opposed ? "versus" : null;
  }
  if (/\brather my partner (?:make the first move|lead|take the lead|take charge|decide)\b/iu.test(line))
    return "versus";
  const lead = LEAD.some((pattern) => pattern.test(line));
  const yields = YIELD.some((pattern) => pattern.test(line));
  return lead === yields ? null : lead ? "lead" : "yield";
}

/** A love interest's mean answer over the statements of each side, or undefined for a side they never answered. */
export function quizPoles(statements: readonly QuizStatementView[], li: LiId): Partial<Record<QuizSide, number>> {
  const poles: Partial<Record<QuizSide, number>> = {};
  for (const side of ["lead", "yield"] as const) {
    const scores = statements.flatMap((statement) =>
      statement.power?.side === side && statement.scores[li] ? [statement.scores[li]!] : [],
    );
    if (scores.length) poles[side] = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }
  return poles;
}

/**
 * The answer of the player's that goes best with `theirs`. Plain statements: the same answer. A pair's half: the love
 * interest's answer on the other half (`partner`). Otherwise a side's statement goes with their mean on the other side,
 * and `versus`, or a side they never answered, with the mirror (6 − theirs).
 */
export function quizTarget(
  power: QuizPowerView | undefined,
  theirs: number,
  partner?: number,
  poles?: Partial<Record<QuizSide, number>>,
): number {
  if (!power) return theirs;
  if (partner !== undefined) return partner;
  const other = power.side === "lead" ? poles?.yield : power.side === "yield" ? poles?.lead : undefined;
  return other ?? 6 - theirs;
}

/**
 * How well the player and `li` go together, 0–100: the mean of 1 − |player − target| / 4 over the statements both
 * answered (quizTarget), with the love interest's other answers read from `pool` (every statement they answered, open
 * ones too). Null before there is one.
 */
export function quizAgreement(
  answered: readonly QuizStatementView[],
  li: LiId,
  pool: readonly QuizStatementView[] = answered,
): number | null {
  const poles = quizPoles(pool, li);
  const byId = new Map(pool.map((statement) => [statement.id, statement]));
  let sum = 0;
  let count = 0;
  for (const statement of answered) {
    const theirs = statement.scores[li];
    if (!statement.answer || !theirs) continue;
    const pair = statement.power?.pair;
    const partner = pair ? byId.get(pair)?.scores[li] : undefined;
    sum += 1 - Math.abs(statement.answer - quizTarget(statement.power, theirs, partner, poles)) / 4;
    count += 1;
  }
  return count ? Math.round((sum / count) * 100) : null;
}

/** Some statement the player and `li` both answered is scored as a complement, so the score reads as compatibility. */
export const quizComplements = (answered: readonly QuizStatementView[], li: LiId) =>
  answered.some((statement) => statement.power && statement.answer && statement.scores[li]);

// Otome Hearth personality quiz: statements about who leads and who yields come in pairs and score as complements.
import assert from "node:assert/strict";
import test from "node:test";
import type { LiId } from "../packages/otome-forge/src/engine/packages/client/src/features/otome-forge/shared/api-types.ts";
import {
  quizAgreement,
  quizComplements,
  quizPowerOf,
  quizTarget,
  type QuizPower,
  type QuizScore,
  type QuizStatementView,
} from "../packages/otome-forge/src/engine/packages/client/src/features/otome-forge/shared/quiz.ts";
import {
  newQuizStatements,
  normalizeQuiz,
  parseQuizLines,
  quizView,
  writtenFrom,
} from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/minigames/quiz.ts";
import {
  QUIZ_PAIRS,
  QUIZ_STARTERS,
} from "../packages/otome-forge/src/engine/packages/server/src/services/otome-forge/minigames/quiz-statements.ts";

const DOM = "li-dom-aaaa" as LiId;
const SUB = "li-sub-aaaa" as LiId;
const VANILLA = "li-vanilla-aaaa" as LiId;
const byId = new Map(QUIZ_STARTERS.map((entry) => [entry.id, entry]));

test("the starters' power pairs: one half per side, same visibility, each pointing at the other", () => {
  assert.equal(QUIZ_STARTERS.filter((statement) => statement.power).length, QUIZ_PAIRS.length * 2);
  for (const [lead, yields] of QUIZ_PAIRS) {
    const a = byId.get(lead)!;
    const b = byId.get(yields)!;
    assert.deepEqual(a.power, { side: "lead", pair: yields });
    assert.deepEqual(b.power, { side: "yield", pair: lead });
    assert.equal(a.adult, b.adult, `${lead} and ${yields} show together`);
  }
  assert.equal(byId.get("i02")!.text, "I like to be in control in bed.", "stored answers keep their statement");
  assert.equal(byId.get("i33")!.text, "I like being the one who decides what happens in bed.");
});

test("older written statements: one side of the power axis is read by its wording, anything else is left alone", () => {
  const expected: Array<[string, QuizPower | null]> = [
    ["I like pinning my partner down.", "lead"],
    ["I enjoy spanking a partner.", "lead"],
    ["I get off on making my partner beg.", "lead"],
    ["I'd enjoy deciding when my partner is allowed to come.", "lead"],
    ["I like giving a partner strict rules to follow in bed.", "lead"],
    ["I love a partner who obeys even when it's hard.", "lead"],
    ["I like watching a partner's hands shake while they obey me.", "lead"],
    ["I like being the one who decides when sex is over.", "lead"],
    ["I like having my wrists held down.", "yield"],
    ["Being used for my partner's pleasure turns me on.", "yield"],
    ["I'd enjoy begging for what I want in bed.", "yield"],
    ["I like being on my knees for a partner.", "yield"],
    ["I like being told how to touch myself while someone watches.", "yield"],
    ["I like being spanked until my skin is warm.", "yield"],
    ["The feeling of a strong hand around my throat excites me.", "yield"],
    ["I’d rather my partner make the first move.", "versus"],
    ["I'd rather follow than lead.", "versus"],
    ["I like being told my body is beautiful.", null],
    ["I like making my partner blush.", null],
    ["I like being called a pet name in bed.", null],
    ["I follow orders even when I disagree with them.", null],
    ["A calm, steady voice giving orders is hotter than a shouted one.", null],
    ["I'd rather be needed than loved.", null],
    ["I'd rather be feared than liked.", null],
    ["I don't like being tied up.", null],
    ["I'd never let a partner decide what I wear.", null],
    ["I enjoy switching between leading and following in bed.", null],
    ["I like sex best when one of us clearly holds the power.", null],
    ["I want my partner to be the one who decides.", null],
    ["I get off on making my partner beg for it.", null],
    ["I like being on top while my partner lies back.", null],
  ];
  for (const [text, power] of expected) assert.equal(quizPowerOf(text), power, text);
});

test("the maths: likeness for plain statements, the other half for a pair, the other side for older ones", () => {
  const match =
    (...args: Parameters<typeof quizTarget>) =>
    (player: number) =>
      1 - Math.abs(player - quizTarget(...args)) / 4;
  assert.equal(match(undefined, 4)(4), 1);
  assert.equal(match(undefined, 1)(5), 0);
  assert.equal(match({ side: "yield", pair: "i02" }, 1, 5)(5), 1, "wanting to yield goes with their wanting to lead");
  assert.equal(match({ side: "yield", pair: "i02" }, 5, 1)(5), 0, "not with their wanting to yield too");
  assert.equal(match({ side: "lead", pair: "i03" }, 2, 3)(3), 1, "neutral goes with neutral");
  assert.equal(match({ side: "yield" }, 1, undefined, { lead: 5 })(5), 1);
  assert.equal(match({ side: "yield" }, 1, undefined, { lead: 1 })(5), 0, "not with merely not wanting to yield");
  assert.equal(match({ side: "yield" }, 1)(5), 1, "no answers on the other side: the mirror");
  assert.equal(match({ side: "versus" }, 1)(5), 1);
  assert.equal(match({ side: "versus" }, 4)(4), 0.5);
});

const statement = (
  id: string,
  answer: QuizScore | undefined,
  scores: Partial<Record<LiId, QuizScore>>,
  text = byId.get(id)!.text,
): QuizStatementView => {
  const older = quizPowerOf(text);
  const power = byId.get(id)?.power ?? (older ? { side: older } : undefined);
  return { id, text, scores, ...(answer ? { answer } : {}), ...(power ? { power } : {}) };
};

const subPlayerQuiz = () => [
  statement("i02", 1, { [DOM]: 5, [SUB]: 1, [VANILLA]: 1 }),
  statement("i03", 5, { [DOM]: 1, [SUB]: 5, [VANILLA]: 1 }),
  statement("i05", 5, { [DOM]: 1, [SUB]: 5, [VANILLA]: 1 }),
  statement("i06", 1, { [DOM]: 5, [SUB]: 1, [VANILLA]: 1 }),
  statement("i18", 5, { [DOM]: 2, [SUB]: 5, [VANILLA]: 1 }),
  statement("i33", 1, { [DOM]: 5, [SUB]: 1, [VANILLA]: 2 }),
  statement("p09", 2, { [DOM]: 4, [SUB]: 2, [VANILLA]: 3 }),
  statement("p29", 4, { [DOM]: 2, [SUB]: 4, [VANILLA]: 3 }),
];

test("a sub player matches a dom love interest best, and neither a sub nor a vanilla one", () => {
  const answered = subPlayerQuiz();
  const dom = quizAgreement(answered, DOM)!;
  const sub = quizAgreement(answered, SUB)!;
  const vanilla = quizAgreement(answered, VANILLA)!;
  assert.ok(dom >= 90, `dom ${dom}`);
  assert.ok(sub <= 25, `sub ${sub}`);
  assert.ok(dom - vanilla >= 30, `vanilla ${vanilla}`);
  const asLikeness = answered.map(({ power: _power, ...rest }) => rest);
  assert.ok(quizAgreement(asLikeness, SUB)! > quizAgreement(asLikeness, DOM)!, "likeness alone had it backwards");
  assert.ok(quizComplements(answered, DOM));
  assert.ok(!quizComplements(asLikeness, DOM));
});

test("a pair's other half counts from open statements too", () => {
  const answered = [statement("i05", 5, { [DOM]: 5 })];
  const open = [statement("i06", undefined, { [DOM]: 5 })];
  assert.equal(quizAgreement(answered, DOM), 0, "without it, the mirror of their own answer");
  assert.equal(quizAgreement(answered, DOM, [...answered, ...open]), 100);
});

test("an older statement read by its wording goes with the love interest's answers on the other side", () => {
  const older = statement("w3", 5, { [DOM]: 1 }, "I like having my wrists held down.");
  const pool = [older, statement("i06", undefined, { [DOM]: 5 }), statement("i02", undefined, { [DOM]: 4 })];
  assert.equal(quizAgreement([older], DOM, pool), 88);
});

test("plain statements still score as likeness", () => {
  const answered = [statement("p01", 4, { [DOM]: 1 })];
  assert.equal(quizAgreement(answered, DOM), 25);
  assert.ok(!quizComplements(answered, DOM));
});

test("a refill's [lead N] and [yield N] lines become a pair; a half left alone, or two of a side, is plain", () => {
  const units = [{ id: DOM, name: "Kai" }] as unknown as Parameters<typeof newQuizStatements>[2];
  const reply = parseQuizLines(
    [
      "[18+] [lead 1] I like pinning my partner down: Kai 5",
      "[18+] **[yield 1]** I like having my wrists held down: Kai 1",
      "[lead 2] I like being the one who plans our weekends: Kai 4",
      "[18+] [yield 3] I like being told to wait: Kai 2",
      "[yield 3] I like being told to be patient: Kai 2",
      "[lead 3] I like making someone wait for me: Kai 4",
      "Rain is comforting to me: Kai 3",
    ].join("\n"),
  )!;
  assert.deepEqual(reply.lines[1]!.pair, { side: "yield", key: 1 });
  assert.equal(reply.lines[1]!.statement, "I like having my wrists held down");
  assert.equal(reply.lines[1]!.adult, true);
  const written = writtenFrom(newQuizStatements(reply, [], units, true), 250);
  assert.deepEqual(
    written.map((entry) => [entry.id, entry.power]),
    [
      ["w251", { side: "lead", pair: "w252" }],
      ["w252", { side: "yield", pair: "w251" }],
      ["w253", undefined],
      ["w254", undefined],
      ["w255", undefined],
      ["w256", undefined],
      ["w257", undefined],
    ],
  );
});

const run = (heat: string) =>
  ({ world: { content: { heat } }, units: [], state: { lis: {} } }) as unknown as Parameters<typeof quizView>[0];
const powers = (view: ReturnType<typeof quizView>) =>
  Object.fromEntries([...view.open, ...view.answered].map((entry) => [entry.id, entry.power]));
const idle = { scoring: false, refilling: false };

test("the view: pairs carry their other half; only statements from before paired refills are read by wording", () => {
  const stored = {
    version: 1,
    written: [
      { id: "w1", text: "I like having my wrists held down.", adult: true },
      { id: "w2", text: "I like pinning my partner down.", adult: true, power: { side: "lead", pair: "w3" } },
      {
        id: "w3",
        text: "I like it when my partner holds me still.",
        adult: true,
        power: { side: "yield", pair: "w2" },
      },
      { id: "w4", text: "I like being on my knees for a partner.", adult: true },
      { id: "w5", text: "Rain is comforting to me.", adult: true, power: { side: "lead", pair: "w9" } },
    ],
    scores: {},
    answers: {},
    pairsSince: 1,
  };
  const doc = normalizeQuiz(stored);
  assert.equal(doc.written[4]!.power, undefined, "a half whose other half is missing is plain");
  const view = powers(quizView(run("nsfw"), doc, idle));
  assert.deepEqual(view.i02, { side: "lead", pair: "i03" });
  assert.deepEqual(view.p09, { side: "lead", pair: "p29" });
  assert.deepEqual(view.w1, { side: "yield" }, "older than the first paired refill: by its wording");
  assert.deepEqual(view.w2, { side: "lead", pair: "w3" });
  assert.deepEqual(view.w3, { side: "yield", pair: "w2" });
  assert.equal(view.w4, undefined, "written since pairs: an unpaired statement is plain, whatever it says");
  assert.equal(view.w5, undefined);
  assert.equal(view.p01, undefined);
  const before = powers(quizView(run("nsfw"), normalizeQuiz({ ...stored, pairsSince: undefined }), idle));
  assert.deepEqual(before.w4, { side: "yield" }, "before any paired refill, every written statement is older");
});

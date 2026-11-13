import assert from "node:assert/strict";
import {
  claimSlurpPostSequence,
  peekSlurpPostSequence,
  readSlurpPostSequence,
  slurpNextPostSequence,
  slurpPostSequenceKey,
} from "../packages/slurp2/src/engine/packages/server/src/slp/modules/feed/slp-post-sequence.ts";
import { slurp2Source } from "./slurp2-source";

// Each generation draws on its own sequence. The post count was the sequence, and posts are stored
// only when they publish, so two posts prepared ahead read the same count and drew identical
// details, angle and spice. 6-11 sequence values per Creator were used twice.

// Pure rule: one more than the last handed out, never below the post count.
assert.equal(slurpNextPostSequence(5, null), 5, "a Creator with no stored sequence starts at the post count");
assert.equal(slurpNextPostSequence(5, 5), 6);
assert.equal(slurpNextPostSequence(5, 9), 10, "a purge that lowers the count does not move the sequence back");
assert.equal(slurpNextPostSequence(12, 9), 12, "posts made elsewhere move it forward");
assert.equal(slurpNextPostSequence(Number.NaN, null), 0);
assert.equal(readSlurpPostSequence("7"), 7);
for (const raw of [null, undefined, "", "x", "-1", "1.5"]) assert.equal(readSlurpPostSequence(raw), null, String(raw));

async function main() {
  // The storage hands out unique, increasing values while the post count stands still, also when
  // claims overlap, and a peek never hands one out.
  const settings = new Map<string, string>();
  let postCount = 3;
  const store = (accountId: string) => ({
    count: async () => postCount,
    get: async () => settings.get(slurpPostSequenceKey(accountId)) ?? null,
    set: async (value: string) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      settings.set(slurpPostSequenceKey(accountId), value);
    },
  });
  assert.equal(await peekSlurpPostSequence(store("creator-a")), 3);
  assert.equal(await peekSlurpPostSequence(store("creator-a")), 3, "a peek hands nothing out");
  const claimed = await Promise.all(
    Array.from({ length: 6 }, () => claimSlurpPostSequence("creator-a", store("creator-a"))),
  );
  assert.deepEqual(
    [...claimed].sort((a, b) => a - b),
    [3, 4, 5, 6, 7, 8],
  );
  assert.equal(new Set(claimed).size, claimed.length, "no two generations share a sequence");
  assert.equal(await peekSlurpPostSequence(store("creator-a")), 9, "the next peek is the next claim");
  postCount = 1; // a purge
  assert.equal(await claimSlurpPostSequence("creator-a", store("creator-a")), 9);
  assert.equal(await claimSlurpPostSequence("creator-b", store("creator-b")), 1, "each Creator has its own sequence");
  assert.equal(settings.get(slurpPostSequenceKey("creator-a")), "9");

  // Wiring: a generation claims, a preview, the access choice and slot planning only peek, and a
  // deleted Creator's sequence goes with it.
  const server = (path: string) => slurp2Source(`packages/slurp2/src/engine/packages/server/src/slp/${path}`);
  assert.match(
    server("features/feed/slp-generation-service.ts"),
    /const sequence = await noodle\.nextNoodlerPostSequence\(account\.id, \{ claim: !input\.previewOnly \}\)/u,
  );
  assert.match(server("features/feed/slp-automatic-post-access.ts"), /noodle\.peekNoodlerPostSequence\(accountId\)/u);
  assert.match(server("features/feed/slp-prompt-preview-service.ts"), /slurp\.peekNoodlerPostSequence\(account\.id\)/u);
  assert.doesNotMatch(server("features/feed/reserve/slp-reserve-operation.ts"), /countNoodlerPostsByAccount/u);
  assert.match(
    server("data/feed/slp-feed-post-storage-1.ts"),
    /options\.claim \? claimSlurpPostSequence\(accountId, store\) : peekSlurpPostSequence\(store\)/u,
  );
  assert.match(
    server("data/creators/slp-creators-storage-2.ts"),
    /settings\.remove\(slurpPostSequenceKey\(accountId\)\)/u,
  );

  console.log("slurp2 unique sequence regression checks passed");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

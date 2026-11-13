/**
 * The sequence a post draws its details, angle and spice on, unique per Creator.
 *
 * The post count used to be the sequence. Posts are prepared ahead of their slot and stored only
 * when they publish, and old posts are purged, so two generations could read the same count and
 * draw the same details, angle and spice. The sequence handed out now never repeats and never
 * goes down: one more than the last one handed out, and never below the post count.
 *
 * `data/feed/slp-feed-post-storage-1.ts` keeps the last one handed out per Creator, in an app setting.
 */

export const SLURP_POST_SEQUENCE_KEY = "slurp2.post-sequence";

/** The app setting that holds one Creator's last handed-out sequence. */
export function slurpPostSequenceKey(accountId: string): string {
  return `${SLURP_POST_SEQUENCE_KEY}.${accountId}`;
}

/** The stored last sequence, or null when none was handed out yet or the value is unreadable. */
export function readSlurpPostSequence(raw: string | null | undefined): number | null {
  const value = Number(raw);
  return raw != null && raw !== "" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** The next sequence: one more than the last one handed out, and never below the post count. */
export function slurpNextPostSequence(postCount: number, last: number | null): number {
  const count = Number.isFinite(postCount) ? Math.max(0, Math.floor(postCount)) : 0;
  return last === null ? count : Math.max(count, last + 1);
}

/** Where one Creator's sequence is read from and kept. */
export type SlurpPostSequenceStore = {
  count: () => Promise<number>;
  get: () => Promise<string | null | undefined>;
  set: (value: string) => Promise<void>;
};

/** The sequence the next post would draw on, without handing it out. */
export async function peekSlurpPostSequence(store: SlurpPostSequenceStore): Promise<number> {
  return slurpNextPostSequence(await store.count(), readSlurpPostSequence(await store.get()));
}

// ponytail: an in-process queue per Creator, like the ties document; one server process writes.
const claims = new Map<string, Promise<unknown>>();

/** Hands out the next sequence. Claims for one Creator run one at a time, so none is handed out twice. */
export function claimSlurpPostSequence(accountId: string, store: SlurpPostSequenceStore): Promise<number> {
  const run = (claims.get(accountId) ?? Promise.resolve()).then(async () => {
    const next = await peekSlurpPostSequence(store);
    await store.set(String(next));
    return next;
  });
  const settled = run.catch(() => undefined);
  claims.set(accountId, settled);
  void settled.then(() => {
    if (claims.get(accountId) === settled) claims.delete(accountId);
  });
  return run;
}

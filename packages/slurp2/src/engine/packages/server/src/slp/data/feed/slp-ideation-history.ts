/**
 * A Creator's recent ideas, newest first, for the idea step (`modules/feed/slp-post-ideation.ts`).
 *
 * Prepared posts count, ahead of the published ones: generation runs ahead of publication, so a post
 * written now often goes up after others already written. A post without a stored idea (before the
 * setting, or a directed post) contributes its beat, never its title: titles fed the old title loop.
 */
import type { DB } from "../../../db/connection.js";
import { and, eq } from "../../../db/file-query.js";
import { slpCreatorPreparedPosts } from "../../../db/schema/slurp.js";
import { createSlurpStorage } from "../slp-storage.js";
import { parseRecord, type SlpCreatorPreparedPostPayload } from "../../modules/records/slp-storage-model.js";
import type { SlurpIdeaHistoryEntry } from "../../modules/feed/slp-post-ideation.js";

/** One post's idea from its stored metadata, or null when it carries neither an idea nor a beat. */
export function slurpIdeaHistoryEntry(metadata: unknown): SlurpIdeaHistoryEntry | null {
  const record = parseRecord(metadata);
  const idea = parseRecord(record.slurpIdea);
  if (typeof idea.subject === "string" && idea.subject.trim()) {
    return {
      subject: idea.subject,
      idea: typeof idea.idea === "string" ? idea.idea : "",
      followsPlan: typeof idea.followsPlan === "string" ? idea.followsPlan : null,
    };
  }
  const beat = parseRecord(record.slurpBeat);
  if (typeof beat.anchor === "string" && beat.anchor.trim()) {
    return { subject: beat.anchor, idea: typeof beat.line === "string" ? beat.line : "", followsPlan: null };
  }
  return null;
}

export async function listSlurpIdeaHistory(db: DB, accountId: string, limit: number): Promise<SlurpIdeaHistoryEntry[]> {
  const prepared = await db
    .select()
    .from(slpCreatorPreparedPosts)
    .where(and(eq(slpCreatorPreparedPosts.state, "prepared"), eq(slpCreatorPreparedPosts.creatorAccountId, accountId)));
  const ahead = prepared
    .sort((left, right) => right.publishAt.localeCompare(left.publishAt))
    .map((row) => (parseRecord(row.payload) as SlpCreatorPreparedPostPayload).metadata);
  const posted = (await createSlurpStorage(db).listNoodlerPostsByAccount(accountId, limit)).map(
    (post) => post.metadata,
  );
  return [...ahead, ...posted]
    .map(slurpIdeaHistoryEntry)
    .filter((entry): entry is SlurpIdeaHistoryEntry => entry !== null)
    .slice(0, limit);
}

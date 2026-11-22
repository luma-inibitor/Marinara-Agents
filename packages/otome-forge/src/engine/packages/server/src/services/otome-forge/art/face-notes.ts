// ──────────────────────────────────────────────
// Otome Forge: how each love interest shows the five faces, written once from their bible and kept on the unit
// ──────────────────────────────────────────────
import { z, type ZodType } from "zod";
import type { FaceNotes, Unit } from "../../../../../client/src/features/otome-forge/shared/api-types.js";
import { FACES, type Face } from "../../../../../client/src/features/otome-forge/shared/faces.js";
import { generateJson, resolveConnectionId } from "../generation.js";
import { OtomeForgeError } from "../http.js";
import { runDocTarget, unitId, worldId } from "../ids.js";
import { faceNotesMessages } from "../prompts.js";
import { FACE_NOTE_MAX, normalizeUnit } from "../schemas/unit.js";
import { normalizeWorld } from "../schemas/world.js";
import type { ArtDeps } from "./paint.js";

type FaceNotesReply = { restraint: string } & Record<Face, string>;

const line = z.string().trim().min(1).max(FACE_NOTE_MAX);
const FaceNotesReplySchema = z.object({
  restraint: line,
  ...Object.fromEntries(FACES.map((face) => [face, line])),
}) as unknown as ZodType<FaceNotesReply>;

const writing = new Map<string, Promise<FaceNotes | undefined>>();

/** The love interest's face notes, written and kept on the first call; undefined when they could not be written. */
export async function ensureFaceNotes(
  deps: ArtDeps,
  runId: string,
  li: string,
  { debugMode }: { debugMode: boolean },
): Promise<FaceNotes | undefined> {
  const unit = await deps.store.readDoc(unitId(runId, li), normalizeUnit);
  if (!unit) throw new OtomeForgeError(404, "No such love interest.", "not-found");
  if (unit.faceNotes) return unit.faceNotes;
  const key = `${runId}|${li}`;
  const running = writing.get(key);
  if (running) return running;
  const task = writeFaceNotes(deps, runId, unit, debugMode)
    .catch((error: unknown) => {
      deps.runtime.logger.warn(
        "[otome-forge] face notes for %s not written, painting stock faces: %s",
        li,
        error instanceof Error ? error.message : String(error),
      );
      return undefined;
    })
    .finally(() => writing.delete(key));
  writing.set(key, task);
  return task;
}

async function writeFaceNotes(deps: ArtDeps, runId: string, unit: Unit, debugMode: boolean): Promise<FaceNotes> {
  const world = await deps.store.readDoc(worldId(runId), normalizeWorld);
  if (!world) throw new OtomeForgeError(404, "No such Otome Hearth story.", "not-found");
  const connectionId = resolveConnectionId(world, "structured");
  if (!connectionId) throw new OtomeForgeError(503, "No connection is set for the structured job.", "no-connection");
  const { value } = await generateJson(deps, {
    runId,
    connectionId,
    job: "structured",
    label: `face-notes/${unit.id}`,
    messages: faceNotesMessages({ world, unit }),
    schema: FaceNotesReplySchema,
    maxTokens: 1200,
    debugMode,
    lane: "background",
  });
  const notes: FaceNotes = {
    restraint: value.restraint,
    lines: Object.fromEntries(FACES.map((face) => [face, value[face]])) as Record<Face, string>,
    at: new Date().toISOString(),
  };
  const saved = await deps.store.updateDoc(runDocTarget("unit", unitId(runId, unit.id)), normalizeUnit, (current) =>
    current.faceNotes ? current : { ...current, faceNotes: notes },
  );
  return saved?.faceNotes ?? notes;
}

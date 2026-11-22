// ──────────────────────────────────────────────
// Otome Hearth: admin art swap, for installing hand-made art into a run without stopping the Engine
// ──────────────────────────────────────────────
// POST /runs/:run/admin/art-swap {swaps: [{from: {url}, to: {url, ref}}], docs?, dryRun?}
//      → {dryRun, cleanupRevision?, docs: [{id, kind, replaced, swaps}], replacedRefs, warnings}
// Usage and rules: the package README, "Swapping in hand-made art". Old gallery rows are never deleted here.
import { z } from "zod";
import type { Unit } from "../../../../../client/src/features/otome-forge/shared/api-types.js";
import { FACES } from "../../../../../client/src/features/otome-forge/shared/faces.js";
import { clientOf } from "../art/cutout.js";
import { GALLERY_REF_PREFIX, galleryRefIds, loopbackBaseUrl, withEngineLocalAuth } from "../art/image-client.js";
import { OtomeForgeError, parseBody, runParam, type OtomeRouter, type RouteDeps } from "../http.js";
import { ID_PREFIX, RUN_DOC_KINDS, runDocTarget, type RunDocKind } from "../ids.js";
import { isRecord, wornLookUrl } from "../schemas/common.js";
import { normalizeUnit } from "../schemas/unit.js";

const SWAPS_MAX = 200;
const PROBLEMS_SHOWN = 20;
const GALLERY_FILE = "/api/global-gallery/file/";

const ArtUrl = z.string().min(2).max(2000).startsWith("/");
const SwapBody = z.object({
  swaps: z
    .array(
      z.object({
        from: z.object({ url: ArtUrl }),
        to: z.object({ url: ArtUrl, ref: z.string().regex(/^global-gallery:[A-Za-z0-9_-]+$/) }),
      }),
    )
    .min(1)
    .max(SWAPS_MAX),
  docs: z.array(z.string().min(1).max(300)).max(1000).optional(),
  dryRun: z.boolean().optional(),
});

export interface GalleryRow {
  id: string;
  filePath: string;
}

export interface GalleryLookup {
  rows(): Promise<GalleryRow[]>;
}

export function createGalleryLookup({
  baseUrl = loopbackBaseUrl(),
  fetch: injectedFetch = globalThis.fetch,
}: { baseUrl?: string; fetch?: typeof fetch } = {}): GalleryLookup {
  const fetchImpl = withEngineLocalAuth(injectedFetch);
  return {
    async rows() {
      const response = await fetchImpl(`${baseUrl}/api/global-gallery`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new OtomeForgeError(502, `The Global Gallery list failed (${response.status}).`);
      const rows: unknown = await response.json();
      return (Array.isArray(rows) ? rows : []).flatMap((row: unknown) =>
        isRecord(row) && typeof row.id === "string" && typeof row.filePath === "string"
          ? [{ id: row.id, filePath: row.filePath }]
          : [],
      );
    },
  };
}

type Target = { url: string; ref: string };

export interface SwapWarning {
  doc: string;
  code:
    | "cutout-stale"
    | "cutout-not-ready"
    | "cutout-missing"
    | "cutout-unchanged"
    | "faces-missing"
    | "faces-not-ready"
    | "faces-incomplete";
  url: string;
  message: string;
}

interface Tally {
  replaced: number;
  byFrom: Map<string, number>;
  oldRefs: Map<string, Set<string>>;
  collisions: string[];
}

const newTally = (): Tally => ({ replaced: 0, byFrom: new Map(), oldRefs: new Map(), collisions: [] });

function hit(tally: Tally, from: string) {
  tally.replaced += 1;
  tally.byFrom.set(from, (tally.byFrom.get(from) ?? 0) + 1);
}

/** `value` with every swap applied; pure, so a revision retry gives the same result for the same data. */
export function swapArt(
  value: unknown,
  swaps: ReadonlyMap<string, Target>,
  tally: Tally,
  revision: number | undefined,
  key?: string,
): unknown {
  if (typeof value === "string") {
    const to = swaps.get(value);
    if (!to) return value;
    hit(tally, value);
    return to.url;
  }
  if (Array.isArray(value)) return value.map((item) => swapArt(item, swaps, tally, revision));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(value)) {
    const to = swaps.get(name);
    if (to) {
      hit(tally, name);
      if (to.url in out || to.url in value) tally.collisions.push(to.url);
    }
    out[to ? to.url : name] = swapArt(child, swaps, tally, revision, name);
  }
  for (const [name, original] of Object.entries(value)) {
    const to = typeof original === "string" ? swaps.get(original) : undefined;
    if (!to) continue;
    const refKey = name === "url" ? "ref" : `${name}Ref`;
    if (name !== "url" && name !== "portrait" && !(refKey in value)) continue;
    const old = value[refKey];
    if (typeof old === "string" && old !== to.ref) {
      const refs = tally.oldRefs.get(original as string) ?? new Set<string>();
      refs.add(old);
      tally.oldRefs.set(original as string, refs);
    }
    out[refKey] = to.ref;
  }
  if (key === "cutouts") {
    for (const [name, original] of Object.entries(value)) {
      if (!isRecord(original) || typeof original.url !== "string" || !swaps.has(original.url)) continue;
      const entry = out[swaps.get(name)?.url ?? name] as Record<string, unknown>;
      entry.state = "ready";
      delete entry.error;
      const kept = typeof entry.cleanupRevision === "number" ? entry.cleanupRevision : 0;
      if (revision !== undefined && kept < revision) entry.cleanupRevision = revision;
    }
  }
  return out;
}

function cutoutWarnings(
  doc: string,
  value: unknown,
  targets: ReadonlySet<string>,
  revision: number | undefined,
  out: SwapWarning[],
  key?: string,
) {
  if (Array.isArray(value)) {
    for (const item of value) cutoutWarnings(doc, item, targets, revision, out);
    return;
  }
  if (!isRecord(value)) return;
  if (key === "cutouts") {
    for (const [source, entry] of Object.entries(value)) {
      if (!isRecord(entry)) continue;
      const image = typeof entry.url === "string" ? entry.url : "";
      if (!targets.has(source) && !targets.has(image)) continue;
      const state = typeof entry.state === "string" ? entry.state : "";
      const kept = typeof entry.cleanupRevision === "number" ? entry.cleanupRevision : 0;
      if (state !== "ready")
        out.push({
          doc,
          code: "cutout-not-ready",
          url: source,
          message: `The cut-out of ${source} is ${state || "missing its state"}; Home cuts it out again on its next read.`,
        });
      else if (revision !== undefined && kept < revision)
        out.push({
          doc,
          code: "cutout-stale",
          url: source,
          message: `The cut-out of ${source} is at cleanup revision ${kept}, below ${revision}; it is rebuilt on the next read.`,
        });
      if (targets.has(source) && !targets.has(image))
        out.push({
          doc,
          code: "cutout-unchanged",
          url: source,
          message: `${source} still shows its old cut-out ${image || "(none)"}; swap that too, or Home shows the old pixels.`,
        });
    }
    return;
  }
  for (const [name, child] of Object.entries(value)) cutoutWarnings(doc, child, targets, revision, out, name);
}

function unitWarnings(doc: string, unit: Unit, revision: number | undefined, out: SwapWarning[]) {
  const look = wornLookUrl(unit);
  const set = look ? (unit.expressions[look] as { state?: unknown; images?: Record<string, { url?: unknown }> }) : null;
  if (look && !set)
    out.push({
      doc,
      code: "faces-missing",
      url: look,
      message: `The worn look ${look} has no face set; with expressions on, its faces are painted when he next speaks.`,
    });
  else if (look && set?.state !== "ready")
    out.push({
      doc,
      code: "faces-not-ready",
      url: look,
      message: `The worn look's face set is ${String(set?.state)}, so the story shows no faces for it.`,
    });
  else if (look && FACES.some((face) => typeof set?.images?.[face]?.url !== "string"))
    out.push({
      doc,
      code: "faces-incomplete",
      url: look,
      message: `The worn look's face set lacks ${FACES.filter((face) => typeof set?.images?.[face]?.url !== "string").join(", ")}.`,
    });
  const faces = set?.state === "ready" ? Object.values(set.images ?? {}).map((image) => image?.url) : [];
  for (const url of new Set([unit.portrait, look, ...faces])) {
    if (typeof url !== "string" || !url.startsWith(GALLERY_FILE) || unit.cutouts[url]) continue;
    out.push({
      doc,
      code: "cutout-missing",
      url,
      message: `${url} has no cut-out; the Engine's sprite cleanup makes one on the next read${revision ? ` (revision ${revision})` : ""}.`,
    });
  }
}

interface RunDoc {
  id: string;
  kind: RunDocKind;
  data: unknown;
}

async function runDocs(deps: Pick<RouteDeps, "store">, runId: string): Promise<RunDoc[]> {
  const lists = await Promise.all(
    RUN_DOC_KINDS.map(async (kind) =>
      (await deps.store.listRun(kind, runId)).map((document) => ({ id: document.id, kind, data: document.data })),
    ),
  );
  return lists.flat();
}

const docIdOf = (runId: string, id: string) => (id.startsWith(ID_PREFIX) ? id : `${runId}:${id}`);

export function registerAdminRoutes(
  router: OtomeRouter,
  deps: RouteDeps,
  { gallery = createGalleryLookup() }: { gallery?: GalleryLookup } = {},
) {
  const { store, handle } = deps;

  router.post(
    "/runs/:run/admin/art-swap",
    handle(async (request) => {
      const body = parseBody(SwapBody, request.body);
      const { runId } = runParam(request);
      const problems: string[] = [];
      const swaps = new Map<string, Target>();
      for (const { from, to } of body.swaps) {
        if (swaps.has(from.url)) problems.push(`${from.url} is swapped twice`);
        if (from.url === to.url) problems.push(`${from.url} is swapped to itself`);
        swaps.set(from.url, to);
      }
      for (const { url } of swaps.values())
        if (swaps.has(url)) problems.push(`${url} is both a source and a target; swap in two calls`);

      const rows = new Map((await gallery.rows()).map((row) => [row.id, row]));
      for (const to of swaps.values()) {
        const row = rows.get(to.ref.slice(GALLERY_REF_PREFIX.length));
        if (!row) problems.push(`${to.ref} names no Global Gallery row`);
        else if (`${GALLERY_FILE}${row.filePath.split("/").pop()}` !== to.url)
          problems.push(`${to.ref} is the file ${row.filePath}, not ${to.url}`);
      }

      const all = await runDocs(deps, runId);
      if (!all.length) throw new OtomeForgeError(404, "No such Otome Hearth story.", "not-found");
      const known = new Map(all.map((doc) => [doc.id, doc]));
      const wanted = body.docs ? new Set(body.docs.map((id) => docIdOf(runId, id))) : null;
      for (const id of wanted ?? []) if (!known.has(id)) problems.push(`${id} is not a document of this story`);
      const scope = wanted ? all.filter((doc) => wanted.has(doc.id)) : all;

      const revision = await clientOf(deps)
        .cleanupRevision?.()
        .catch(() => undefined);
      const planned = scope.flatMap((doc) => {
        const tally = newTally();
        const next = swapArt(doc.data, swaps, tally, revision);
        if (tally.collisions.length)
          problems.push(`${doc.id} already has keys ${[...new Set(tally.collisions)].join(", ")}`);
        return tally.replaced ? [{ doc, next, tally }] : [];
      });
      for (const from of swaps.keys())
        if (!planned.some(({ tally }) => tally.byFrom.has(from)))
          problems.push(`${from} is not in ${wanted ? "these documents" : "this story"}`);
      if (problems.length)
        throw new OtomeForgeError(
          400,
          `Nothing was changed: ${problems.slice(0, PROBLEMS_SHOWN).join("; ")}${problems.length > PROBLEMS_SHOWN ? `; and ${problems.length - PROBLEMS_SHOWN} more` : ""}`,
          "bad-request",
        );

      const results = body.dryRun
        ? planned
        : (
            await Promise.all(
              planned.map(async ({ doc }) => {
                const tally = newTally();
                let next: unknown = null;
                await store.updateDoc(
                  runDocTarget(doc.kind, doc.id),
                  (data) => data,
                  (current) => {
                    tally.replaced = 0;
                    tally.byFrom.clear();
                    tally.oldRefs.clear();
                    tally.collisions.length = 0;
                    next = swapArt(current, swaps, tally, revision);
                    if (tally.collisions.length)
                      throw new OtomeForgeError(409, `${doc.id} changed while swapping. Try again.`, "conflict");
                    return next;
                  },
                );
                return next === null || !tally.replaced ? [] : [{ doc, next, tally }];
              }),
            )
          ).flat();

      const after = new Map(all.map((doc) => [doc.id, doc.data]));
      for (const { doc, next } of results) after.set(doc.id, next);
      const targets = new Set([...swaps.values()].map((to) => to.url));
      const warnings: SwapWarning[] = [];
      for (const { doc, next } of results) {
        cutoutWarnings(doc.id, next, targets, revision, warnings);
        if (doc.kind === "unit") unitWarnings(doc.id, normalizeUnit(next), revision, warnings);
      }
      const seen = new Set<string>();
      const replacedRefs = results.flatMap(({ tally }) =>
        [...tally.oldRefs].flatMap(([from, refs]) =>
          [...refs].flatMap((ref) => {
            if (seen.has(ref)) return [];
            seen.add(ref);
            const id = ref.slice(GALLERY_REF_PREFIX.length);
            const heldBy = [...after].flatMap(([docId, data]) => (galleryRefIds(data).includes(id) ? [docId] : []));
            return [{ ref, from, heldBy }];
          }),
        ),
      );
      return {
        dryRun: !!body.dryRun,
        ...(revision !== undefined ? { cleanupRevision: revision } : {}),
        docs: results.map(({ doc, tally }) => ({
          id: doc.id,
          kind: doc.kind,
          replaced: tally.replaced,
          swaps: Object.fromEntries(tally.byFrom),
        })),
        replacedRefs,
        warnings: [
          ...new Map(warnings.map((warning) => [`${warning.doc}|${warning.code}|${warning.url}`, warning])).values(),
        ],
      };
    }),
  );
}

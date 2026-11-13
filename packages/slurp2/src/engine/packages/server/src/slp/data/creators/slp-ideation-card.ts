/**
 * The linked card as the idea step reads it (`modules/feed/slp-post-ideation.ts`): every field that
 * says who they are, not the slice the flavour brief keeps. Read-only.
 *
 * A concealed Creator (hinted or secret) keeps the same rule as the flavour brief: the googleable
 * backstory, and here the scenario, stay out. The writer's identity protection still applies to
 * whatever the idea passes on.
 */
import type { DB } from "../../../db/connection.js";
import { createCharactersStorage } from "../../../lib/host-characters-storage.js";
import type { SlpAccount, SlpIdentityDisclosure } from "../../../../../shared/src/slp/slp-social.types.js";
import { parseRecord } from "../../modules/creators/slp-public-support.js";
import type { SlurpIdeationCard } from "../../modules/feed/slp-post-ideation.js";

const text = (value: unknown) => (typeof value === "string" ? value : "");

export async function readSlurpIdeationCard(
  db: DB,
  source: Pick<SlpAccount, "kind" | "entityId"> | null,
  disclosureMode: SlpIdentityDisclosure,
): Promise<SlurpIdeationCard | null> {
  if (!source) return null;
  const characters = createCharactersStorage(db);
  const open = disclosureMode === "open";
  if (source.kind === "character") {
    const row = await characters.getById(source.entityId);
    if (!row) return null;
    const data = parseRecord(row.data);
    const extensions = parseRecord(data.extensions);
    return {
      description: text(data.description),
      personality: text(data.personality),
      scenario: open ? text(data.scenario) : "",
      backstory: open ? text(data.backstory) || text(extensions.backstory) : "",
      examples: [text(data.mes_example), text(data.first_mes)].filter((value) => value.trim()),
    };
  }
  if (source.kind === "persona") {
    const row = await characters.getPersona(source.entityId);
    if (!row) return null;
    return {
      description: text(row.description),
      personality: text(row.personality),
      scenario: "",
      backstory: open ? text(row.backstory) : "",
      examples: [],
    };
  }
  return null;
}

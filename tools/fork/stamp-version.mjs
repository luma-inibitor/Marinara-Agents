// Set the slurp2 version for a fork build and add its release note to the CHANGELOG and the splash.
//
//   node tools/fork/stamp-version.mjs <fork version> <upstream version> <note>
//
// Run from the repository root.
import { readFile, writeFile } from "node:fs/promises";

const [version, upstream, note] = process.argv.slice(2);
if (!version || !upstream || !note)
  throw new Error("usage: stamp-version.mjs <fork version> <upstream version> <note>");
// The local date, as the upstream notes are written.
const date = new Date().toLocaleDateString("sv-SE");
const text = `Fork build of Slurp ${upstream} with these fixes: ${note}`;

async function edit(path, change) {
  const before = await readFile(path, "utf8");
  const after = change(before);
  if (after === before) throw new Error(`stamp-version: nothing changed in ${path}`);
  await writeFile(path, after);
}

await edit("scripts/build-feature-packages.mjs", (source) =>
  source.replace(/(id: "slurp2",\n\s+version: )"[^"]+"/u, `$1${JSON.stringify(version)}`),
);
await edit("packages/slurp2/src/engine/packages/client/src/slp/features/onboarding/slp-release.ts", (source) =>
  source
    .replace(/SLURP2_VERSION = "[^"]+"/u, `SLURP2_VERSION = ${JSON.stringify(version)}`)
    .replace(
      /(export const SLURP2_RELEASES: Slurp2ReleaseEntry\[\] = \[\n)/u,
      `$1  {\n    version: ${JSON.stringify(version)},\n    date: ${JSON.stringify(date)},\n    notes: [\n      ${JSON.stringify(text)},\n    ],\n  },\n`,
    ),
);
await edit("packages/slurp2/CHANGELOG.md", (source) =>
  source.replace(/^(# [^\n]*\n)/u, `$1\n## ${version} — ${date}\n\n- ${text}\n`),
);
console.log(`slurp2 ${version}`);

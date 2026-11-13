// Point every artifact, artwork and language-pack URL in the generated catalogs at this fork.
//
// The Engine rewrites URLs to Pasta-Devs/<branch> only for the official catalog. With
// MARINARA_AGENT_CATALOG_URL set to this fork, it downloads each entry's artifact.url as written, and
// upstream staging builds write https://raw.githubusercontent.com/Pasta-Devs/Marinara-Agents/main/...,
// where a staging-only version does not exist yet. Run after the build and validation, because
// scripts/validate-catalog.mjs requires the upstream URLs.
//
// Run from the repository root (rebuild.sh runs it from a copy outside the tree).
//
//   node tools/fork/retarget-catalog.mjs [raw root]
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const repoRoot = process.cwd();
const target = (process.argv[2] ?? "https://raw.githubusercontent.com/luma-inibitor/Marinara-Agents/luma/staging").replace(
  /\/+$/u,
  "",
);
const upstream = /^https:\/\/raw\.githubusercontent\.com\/Pasta-Devs\/Marinara-Agents\/(?:main|staging)\/(?=artifacts\/|artwork\/)/u;

async function catalogs(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await catalogs(path)));
    else if (entry.name === "catalog.json") out.push(path);
  }
  return out;
}

function retarget(value) {
  if (typeof value === "string") return value.replace(upstream, `${target}/`);
  if (Array.isArray(value)) return value.map(retarget);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, retarget(v)]));
  return value;
}

let changed = 0;
for (const path of await catalogs(join(repoRoot, "catalog"))) {
  const text = await readFile(path, "utf8");
  const next = `${JSON.stringify(retarget(JSON.parse(text)), null, 2)}\n`;
  if (next !== text) {
    await writeFile(path, next);
    changed += 1;
  }
}
console.log(`retargeted ${changed} catalog file(s) to ${target}`);

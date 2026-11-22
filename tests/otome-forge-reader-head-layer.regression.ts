import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const styles = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../packages/otome-forge/src/engine/packages/client/src/features/otome-forge/theme/styles.ts",
  ),
  "utf8",
);

test("the reader header keeps one compositing layer, so its scrim does not flash on every line", () => {
  const rule = styles.match(/\$\{R\} \.of-reader-head \{([^}]*)\}/u);
  assert.ok(rule, "the .of-reader-head rule");
  assert.match(rule[1], /will-change: transform;/u);
});

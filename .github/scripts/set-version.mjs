#!/usr/bin/env node
// Set the AmpStack version in every file that carries one, so the bundles that
// tauri-action produces are named after the release rather than drifting from it.
//
//   node .github/scripts/set-version.mjs 0.1.6
//
// Release CI runs this with the pushed tag (minus the leading "v"). Run it by
// hand when bumping the version before tagging.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Usage: set-version.mjs <version>   (got: ${version ?? "nothing"})`);
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Replace the first match of `pattern` in a file, failing loudly if it is missing. */
function patch(relativePath, pattern, replacement) {
  const path = join(root, relativePath);
  const before = readFileSync(path, "utf8");
  if (!pattern.test(before)) {
    console.error(`No version field matched in ${relativePath}`);
    process.exit(1);
  }
  const after = before.replace(pattern, replacement);
  if (after !== before) {
    writeFileSync(path, after);
  }
  console.log(`${relativePath} -> ${version}`);
}

patch("package.json", /"version": "[^"]*"/, `"version": "${version}"`);
patch("src-tauri/tauri.conf.json", /"version": "[^"]*"/, `"version": "${version}"`);
patch("src-tauri/Cargo.toml", /^version = "[^"]*"/m, `version = "${version}"`);
patch(
  "src-tauri/Cargo.lock",
  /(name = "ampstack"\nversion = )"[^"]*"/,
  `$1"${version}"`,
);

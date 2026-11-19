#!/usr/bin/env node
// Generates profiles/roles.json, the published roles table that cLoop reads for its --builders option.
// It is derived from the ROLES AND INVOCATION table of profiles/cheap.md and profiles/cheap-100.md.
//
//   node tools/roles.mjs           write profiles/roles.json
//   node tools/roles.mjs --check   exit 1 if profiles/roles.json is out of date
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILES = ["cheap", "cheap-100"];
const EDITION = { codex: "main", "claude-exp": "exp", claude: "claude-edition" };

export function parseRoles(profileText) {
  const start = profileText.indexOf("\n## ROLES AND INVOCATION\n");
  if (start < 0) throw new Error("no ROLES AND INVOCATION section");
  const end = profileText.indexOf("\n## ", start + 1);
  const rows = profileText
    .slice(start, end < 0 ? undefined : end)
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Role |"));
  return rows.map((line) => {
    const [role, modelCell, runAs] = line.split(" | ").map((cell) => cell.replace(/^\| /, "").trim());
    const m = modelCell.match(/^(.+?), (\S+)(?: \((?:`([^`]+)`|recommended)\))?$/);
    if (!m) throw new Error(`cannot parse model cell: ${modelCell}`);
    const entry = { role, model: m[1], effort: m[2], runAs };
    if (m[3]) entry.alias = m[3];
    if (/\(dynamic implementer\)/.test(role)) entry.builder = "dynamic";
    if (/\(mechanical implementer\)/.test(role)) entry.builder = "mechanical";
    return entry;
  });
}

export function buildRoles(root = ROOT) {
  const catalog = JSON.parse(readFileSync(path.join(root, "profiles", "catalog.json"), "utf8"));
  const harness = catalog.harness || "codex";
  const profiles = {};
  for (const id of PROFILES) {
    profiles[id] = parseRoles(readFileSync(path.join(root, "profiles", `${id}.md`), "utf8"));
    const builders = profiles[id].filter((r) => r.builder).map((r) => r.builder).sort();
    if (builders.join() !== "dynamic,mechanical") throw new Error(`${id}: expected one dynamic and one mechanical builder`);
  }
  return { schemaVersion: 1, package: "cheapGPT", version: catalog.packageVersion, edition: EDITION[harness], harness, profiles };
}

export function rolesText(root = ROOT) {
  return JSON.stringify(buildRoles(root), null, 2) + "\n";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.join(ROOT, "profiles", "roles.json");
  const text = rolesText();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(file, "utf8");
    } catch {}
    if (current !== text) {
      process.stderr.write("profiles/roles.json is out of date; run node tools/roles.mjs\n");
      process.exit(1);
    }
    process.stdout.write("roles.json OK\n");
  } else {
    writeFileSync(file, text);
    process.stdout.write("wrote profiles/roles.json\n");
  }
}

#!/usr/bin/env node
/**
 * Phase-2 incremental god-file split (run once on current tree).
 * Usage: node scripts/split-phase2.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function readLines(file) {
  return readFileSync(join(ROOT, file), "utf8").split("\n");
}

function sliceLines(allLines, start, end) {
  return allLines.slice(start - 1, end).join("\n");
}

function removeRanges(allLines, ranges) {
  const src = [...allLines];
  for (const { start, end } of [...ranges].sort((a, b) => b.start - a.start)) {
    src.splice(start - 1, end - start + 1);
  }
  return src.join("\n").replace(/\n{4,}/g, "\n\n\n");
}

// ── 1. Seed data → src/data/runtime-seeds.mjs ───────────────────────────────
const SEED_RANGES = [
  { start: 775, end: 834, name: "MARKET_FALLBACK" },
  { start: 1276, end: 1577, name: "FUNDAMENTALS" },
  { start: 1579, end: 1583, name: "CRYPTO_FALLBACK" },
  { start: 1585, end: 1668, name: "GOVERNMENT_SIGNAL_EXPOSURES" },
  { start: 1670, end: 1967, name: "RAW_POLICY_BILLS" },
  { start: 1969, end: 1975, name: "LOBBYING_FALLBACK" },
  { start: 1977, end: 2087, name: "RAW_POLICY_STAKEHOLDERS" }
];

const serverLines = readLines("server.mjs");
const seedBody = SEED_RANGES.map((r) => sliceLines(serverLines, r.start, r.end)).join("\n\n");
const seedExports = SEED_RANGES.map((r) => r.name).join(",\n  ");
mkdirSync(join(ROOT, "src/data"), { recursive: true });
writeFileSync(
  join(ROOT, "src/data/runtime-seeds.mjs"),
  `${seedBody}\n\nexport {\n  ${seedExports}\n};\n`,
  "utf8"
);

let server = removeRanges(serverLines, SEED_RANGES);
const seedImport = `import {
  MARKET_FALLBACK,
  FUNDAMENTALS,
  CRYPTO_FALLBACK,
  GOVERNMENT_SIGNAL_EXPOSURES,
  RAW_POLICY_BILLS,
  LOBBYING_FALLBACK,
  RAW_POLICY_STAKEHOLDERS
} from "./src/data/runtime-seeds.mjs";`;
server = server.replace(
  'import { isStrictDataMode, productionReadiness } from "./src/core/productionDataMode.mjs";',
  `import { isStrictDataMode, productionReadiness } from "./src/core/productionDataMode.mjs";\n${seedImport}`
);
writeFileSync(join(ROOT, "server.mjs"), server, "utf8");

// ── 2. Client chunks ────────────────────────────────────────────────────────
const appLines = readLines("public/app.js");
const CLIENT_SLICES = [
  { start: 1, end: 903, out: "public/js/08-watchlist.js" },
  { start: 1408, end: 2619, out: "public/js/09-setup.js" },
  { start: 2622, end: 2993, out: "public/js/10-render-analysis.js" },
  { start: 3800, end: 4773, out: "public/js/11-render-chrome.js" },
  { start: 4774, end: 6324, out: "public/js/12-render-markets.js" },
  { start: 6326, end: 7854, out: "public/js/13-render-tabs.js" }
];

for (const s of CLIENT_SLICES) {
  mkdirSync(dirname(join(ROOT, s.out)), { recursive: true });
  writeFileSync(
    join(ROOT, s.out),
    `/* Extracted from app.js lines ${s.start}-${s.end} */\n${sliceLines(appLines, s.start, s.end)}\n`,
    "utf8"
  );
}
writeFileSync(join(ROOT, "public/app.js"), removeRanges(appLines, CLIENT_SLICES), "utf8");

// ── 3. Utils chunk from byok-settings ──────────────────────────────────────
const byokPath = join(ROOT, "public/js/03-byok-settings.js");
const byok = readFileSync(byokPath, "utf8").split("\n");
const utilsStart = byok.findIndex((l) => l.startsWith("async function fetchJson"));
const utilsEnd = byok.findIndex((l, i) => i > utilsStart && l.startsWith("function parseAiBulletItems")) - 1;
const dollarFn = byok.findIndex((l) => l.startsWith("function $("));
const utilsLines = [
  "/* Shared client utilities — load before all other dashboard chunks */",
  ...byok.slice(utilsStart, utilsEnd + 1),
  ...byok.slice(dollarFn, dollarFn + 3)
];
writeFileSync(join(ROOT, "public/js/00-utils.js"), `${utilsLines.join("\n")}\n`, "utf8");
const trimmedByok = byok
  .slice(0, utilsStart)
  .concat(byok.slice(utilsEnd + 1, dollarFn), byok.slice(dollarFn + 3));
writeFileSync(byokPath, trimmedByok.join("\n"), "utf8");

// ── 4. dashboard.html script tags ───────────────────────────────────────────
const dashPath = join(ROOT, "public/dashboard.html");
let dash = readFileSync(dashPath, "utf8");
if (!dash.includes("00-utils.js")) {
  dash = dash.replace(
    '<script src="/assets/js/01-features.js?v=split-1" defer></script>',
    `<script src="/assets/js/00-utils.js?v=split-2" defer></script>
    <script src="/assets/js/01-features.js?v=split-2" defer></script>`
  );
  const newChunks = [
    "08-watchlist.js",
    "09-setup.js",
    "10-render-analysis.js",
    "11-render-chrome.js",
    "12-render-markets.js",
    "13-render-tabs.js"
  ];
  for (const chunk of newChunks) {
    dash = dash.replace(
      '<script src="/assets/app.js?v=split-1" defer></script>',
      `<script src="/assets/js/${chunk}?v=split-2" defer></script>\n    <script src="/assets/app.js?v=split-2" defer></script>`
    );
  }
  dash = dash.replace(/split-1/g, "split-2");
  writeFileSync(dashPath, dash, "utf8");
}

// ── 5. package.json check ─────────────────────────────────────────────────────
const pkgPath = join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (!pkg.scripts.check.includes("runtime-seeds.mjs")) {
  pkg.scripts.check += " && node --check src/data/runtime-seeds.mjs";
  for (const chunk of ["00-utils.js", "08-watchlist.js", "09-setup.js", "10-render-analysis.js", "11-render-chrome.js", "12-render-markets.js", "13-render-tabs.js"]) {
    pkg.scripts.check += ` && node --check public/js/${chunk}`;
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

console.log("Phase-2 split complete.");
console.log("server.mjs:", readLines("server.mjs").length, "lines");
console.log("public/app.js:", readLines("public/app.js").length, "lines");
console.log("src/data/runtime-seeds.mjs:", readLines("src/data/runtime-seeds.mjs").length, "lines");

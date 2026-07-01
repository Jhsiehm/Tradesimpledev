#!/usr/bin/env node
/**
 * Line-range god-file splitter with register(deps) injection for server modules.
 * Client chunks load as classic scripts (shared global scope).
 *
 * Run: node scripts/split-codebase.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** @typedef {{ start: number, end: number, out: string, register?: boolean, exports: string[], inject?: string[], client?: boolean }} Slice */

/** @type {Slice[]} */
const SERVER_SLICES = [
  {
    start: 2098,
    end: 2576,
    out: "src/server/contract-intelligence.mjs",
    register: true,
    exports: [
      "CONTRACT_PROFILES",
      "FIGURE_LINKS",
      "FUND_TAGS",
      "LOBBY_CLIENT_TICKERS",
      "agencySignalScore",
      "awardNoveltyScore",
      "computeGovernmentDependencyScore",
      "computeContractEventSignal",
      "buildGovernmentMoneyTrail",
      "contractCausality"
    ],
    inject: ["sendJson", "runCausalityAnalyzer", "POLICY_BILLS", "remapLinkedBillIds"]
  },
  {
    start: 4076,
    end: 4431,
    out: "src/server/trending.mjs",
    register: true,
    exports: [
      "trendingListHandler",
      "trendingAdminHandler",
      "buildLandingTrendingStrip",
      "refreshTrendingCongressDiscoveries"
    ],
    inject: ["sendJson", "fetchWithTimeout", "withFileLock", "POLICY_BILLS", "DATA_DIR", "TRENDING_TOPICS_FILE", "readFile", "writeFile", "mkdir"]
  },
  {
    start: 4432,
    end: 4977,
    out: "src/server/contract-watch.mjs",
    register: true,
    exports: [
      "contractWatchListHandler",
      "contractWatchAlertsHandler",
      "contractWatchAdminHandler",
      "pickLandingContractAwardLine",
      "getContractWatchPayload"
    ],
    inject: ["sendJson", "fetchWithTimeout", "withFileLock", "DATA_DIR", "CONTRACT_WATCH_FILE", "readFile", "writeFile", "mkdir"]
  },
  {
    start: 4978,
    end: 5115,
    out: "src/server/predictions-api.mjs",
    register: true,
    exports: [
      "predictionScorecardHandler",
      "predictionVerifyHandler",
      "predictionListHandler",
      "predictionRecordHandler",
      "autoRecordSignalPredictions"
    ],
    inject: ["sendJson", "readJson", "quoteSnapshot", "POLICY_BILLS", "computeLegislativeMomentum"]
  },
  {
    start: 14203,
    end: 14343,
    out: "src/server/auth-email.mjs",
    register: true,
    exports: ["authSignup", "authLogin", "authLogoutApi"],
    inject: ["sendJson", "readJson", "setSessionCookie", "clearAuthCookies", "getOnboardingBillMeta", "authRateLimitOk", "upsertUserProfile", "dbReady", "dbSelect", "clientIp"]
  }
];

/** @type {Slice[]} */
const CLIENT_SLICES = [
  { start: 1, end: 55, out: "public/js/01-features.js", exports: [], client: true },
  { start: 9680, end: 10081, out: "public/js/02-byok-helpers.js", exports: [], client: true },
  { start: 10082, end: 11157, out: "public/js/03-byok-settings.js", exports: [], client: true },
  { start: 11158, end: 11220, out: "public/js/04-skeleton.js", exports: [], client: true },
  { start: 11222, end: 11680, out: "public/js/05-track-record.js", exports: [], client: true },
  { start: 7909, end: 9679, out: "public/js/06-signals-desk.js", exports: [], client: true },
  { start: 11681, end: 13333, out: "public/js/07-thesis-map.js", exports: [], client: true }
];

function extractLines(filePath, start, end) {
  const lines = readFileSync(join(ROOT, filePath), "utf8").split("\n");
  return lines.slice(start - 1, end);
}

function removeRanges(filePath, ranges) {
  const lines = readFileSync(join(ROOT, filePath), "utf8").split("\n");
  const sorted = [...ranges].sort((a, b) => b.start - a.start);
  for (const { start, end } of sorted) {
    lines.splice(start - 1, end - start + 1);
  }
  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n");
}

function wrapServerModule(bodyLines, slice) {
  const body = bodyLines.join("\n");
  const stdImports = [
    'import { join } from "node:path";',
    'import { readFile, writeFile, mkdir } from "node:fs/promises";'
  ].join("\n");

  if (!slice.register) {
    return `${stdImports}\nimport { extname, join as pathJoin, dirname } from "node:path";\nimport { existsSync, readFileSync } from "node:fs";\nimport { fileURLToPath } from "node:url";\n\nconst ROOT = dirname(fileURLToPath(import.meta.url));\nconst ROOT_DIR = join(ROOT, "..", "..");\n\n${body.replace(/\bROOT\b/g, "ROOT_DIR").replace(/\bjoin\(/g, "pathJoin(")}\n\nexport {\n  ${slice.exports.join(",\n  ")}\n};\n`;
  }
  return `${stdImports}\n\n/** Injected at boot from server.mjs via register${titleCase(slice.out)}(deps). */\nlet deps = {};\n\nexport function register${titleCase(slice.out)}(next = {}) {\n  deps = { ...deps, ...next };\n}\n\n${body}\n\nexport {\n  ${slice.exports.join(",\n  ")}\n};\n`;
}

function titleCase(outPath) {
  return basename(outPath)
    .replace(/\.mjs$/, "")
    .split(/[-.]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

function basename(p) {
  return p.split("/").pop() || p;
}

function rewriteIdentifiersForDeps(body, slice) {
  if (!slice.register || !slice.inject?.length) return body;
  let out = body;
  for (const name of slice.inject) {
    const re = new RegExp(`\\b${name}\\b`, "g");
    out = out.replace(re, `deps.${name}`);
  }
  return out;
}

function applyServerSplit() {
  for (const slice of SERVER_SLICES) {
    mkdirSync(dirname(join(ROOT, slice.out)), { recursive: true });
    let bodyLines = extractLines("server.mjs", slice.start, slice.end);
    let body = bodyLines.join("\n");
    if (slice.register) body = rewriteIdentifiersForDeps(body, slice);
    const content = slice.register
      ? wrapServerModule(body.split("\n"), slice)
      : wrapServerModule(bodyLines, slice);
    writeFileSync(join(ROOT, slice.out), content, "utf8");
  }

  let server = removeRanges(
    "server.mjs",
    SERVER_SLICES.map((s) => ({ start: s.start, end: s.end }))
  );

  const importBlock = SERVER_SLICES.map((slice) => {
    const rel = `./${slice.out}`;
    const reg = titleCase(slice.out);
    if (slice.register) {
      return `import { register${reg}, ${slice.exports.join(", ")} } from "${rel}";`;
    }
    return `import { ${slice.exports.join(", ")} } from "${rel}";`;
  }).join("\n");

  const marker = 'import { isStrictDataMode, productionReadiness } from "./src/core/productionDataMode.mjs";';
  server = server.replace(
    marker,
    `${marker}\n\n// Domain modules (src/server/*) — see scripts/split-codebase.mjs\n${importBlock}`
  );

  const allInject = [...new Set(SERVER_SLICES.flatMap((s) => s.inject || []))];
  const registerBlock = SERVER_SLICES.filter((s) => s.register)
    .map((slice) => {
      const reg = titleCase(slice.out);
      const keys = [...new Set([...(slice.inject || []), "fetchWithTimeout", "withFileLock", "readFile", "writeFile", "mkdir", "DATA_DIR", "TRENDING_TOPICS_FILE", "CONTRACT_WATCH_FILE", "remapLinkedBillIds", "runCausalityAnalyzer", "quoteSnapshot", "computeLegislativeMomentum", "POLICY_BILLS"])];
      const entries = keys.map((k) => `  ${k}`).join(",\n");
      return `register${reg}({\n${entries}\n});`;
    })
    .join("\n");

  const listenMarker = "server.listen(PORT";
  server = server.replace(
    listenMarker,
    `${registerBlock}\n\n${listenMarker}`
  );

  writeFileSync(join(ROOT, "server.mjs"), server, "utf8");
}

function applyClientSplit() {
  const sorted = [...CLIENT_SLICES].sort((a, b) => a.start - b.start);
  for (const slice of sorted) {
    mkdirSync(dirname(join(ROOT, slice.out)), { recursive: true });
    const lines = extractLines("public/app.js", slice.start, slice.end);
    writeFileSync(
      join(ROOT, slice.out),
      `/* Extracted from app.js lines ${slice.start}-${slice.end} */\n${lines.join("\n")}\n`,
      "utf8"
    );
  }

  const remaining = removeRanges(
    "public/app.js",
    sorted.map((s) => ({ start: s.start, end: s.end }))
  );
  writeFileSync(join(ROOT, "public/app.js"), remaining, "utf8");
}

applyServerSplit();
applyClientSplit();

const serverLines = readFileSync(join(ROOT, "server.mjs"), "utf8").split("\n").length;
const appLines = readFileSync(join(ROOT, "public/app.js"), "utf8").split("\n").length;
console.log(`server.mjs: ${serverLines} lines`);
console.log(`public/app.js: ${appLines} lines`);
console.log(`server modules: ${SERVER_SLICES.length}`);
console.log(`client chunks: ${CLIENT_SLICES.length}`);

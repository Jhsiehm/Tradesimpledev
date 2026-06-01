/**
 * Seed the prediction ledger with illustrative SAMPLE data so the Track Record
 * UI can be demoed and screenshotted before real signals accumulate.
 *
 * Every entry is marked origin:"sample:seed" and sample:true so it is obvious
 * this is demonstration data, not a real verified track record.
 *
 *   node scripts/seed-track-record.mjs          # seed sample data
 *   node scripts/seed-track-record.mjs --wipe   # delete the ledger entirely
 *
 * Wipe before a real launch so the public track record is genuinely earned.
 */
import { writeFile, rm, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LEDGER_FILE = join(ROOT, "data", "predictions.jsonl");

if (process.argv.includes("--wipe")) {
  await rm(LEDGER_FILE, { force: true });
  console.log("Ledger wiped:", LEDGER_FILE);
  process.exit(0);
}

const GENESIS = "GENESIS";
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
}
function hashEvent(prev, e) { return createHash("sha256").update(prev + canonical(e)).digest("hex"); }
const DEADBAND = 1.0;

const SAMPLES = [
  { d: 95, tick: "NVDA", dir: "bullish", conf: 82, entry: 118, exit: 142, spyIn: 510, spyOut: 525, cat: "CHIPS Act appropriations advanced", type: "bill_stage", thesis: "CHIPS Act fab appropriations cleared committee markup — sustained semiconductor capex tailwind for NVDA." },
  { d: 88, tick: "LMT", dir: "bullish", conf: 74, entry: 432, exit: 451, spyIn: 512, spyOut: 524, cat: "NDAA topline raised in markup", type: "bill_stage", thesis: "NDAA topline came in above request; long-cycle Pentagon primes benefit from sustained procurement." },
  { d: 76, tick: "LLY", dir: "bearish", conf: 68, entry: 920, exit: 845, spyIn: 515, spyOut: 528, cat: "Drug pricing negotiation expansion", type: "bill_stage", thesis: "Medicare price-negotiation list expansion advanced — margin pressure risk on key franchises." },
  { d: 64, tick: "PLTR", dir: "bullish", conf: 71, entry: 95, exit: 138, spyIn: 520, spyOut: 531, cat: "DoD AI mesh contract evaluation", type: "contract", thesis: "Defense AI program evaluation closing; incumbent software primes positioned for award." },
  { d: 58, tick: "AAPL", dir: "bearish", conf: 61, entry: 228, exit: 224, spyIn: 522, spyOut: 535, cat: "App Store antitrust markup", type: "bill_stage", thesis: "Self-preferencing antitrust bill regained markup attention — App Store fee risk back in frame." },
  { d: 47, tick: "RTX", dir: "bullish", conf: 66, entry: 118, exit: 121, spyIn: 524, spyOut: 530, cat: "Missile replenishment supplemental", type: "bill_stage", thesis: "Foreign-aid supplemental restocks missile inventories — demand visibility for defense electronics." },
  { d: 41, tick: "COIN", dir: "bullish", conf: 78, entry: 158, exit: 205, spyIn: 526, spyOut: 533, cat: "CLARITY Act market-structure progress", type: "bill_stage", thesis: "Digital-commodity market-structure bill cleared the House — regulatory clarity is a COIN tailwind." },
  { d: 36, tick: "NOC", dir: "bullish", conf: 59, entry: 480, exit: 472, spyIn: 528, spyOut: 545, cat: "NDAA conference reconciliation", type: "bill_stage", thesis: "Conference reconciliation favored long-cycle programs; modest topline support for NOC." },
  { d: 33, tick: "AMD", dir: "bullish", conf: 64, entry: 158, exit: 196, spyIn: 530, spyOut: 540, cat: "CHIPS Act funding tranche", type: "bill_stage", thesis: "Second CHIPS funding tranche opened — broad semiconductor capex visibility benefits AMD." },
  { d: 31, tick: "GOOGL", dir: "bearish", conf: 55, entry: 178, exit: 182, spyIn: 531, spyOut: 538, cat: "Search antitrust remedy hearing", type: "bill_stage", thesis: "Remedy-phase antitrust attention returned — vertical placement risk for Search." },
  { d: 12, tick: "NVDA", dir: "bullish", conf: 80, open: true, entry: 138, spyIn: 540, cat: "CHIPS Act appropriations advanced", type: "bill_stage", thesis: "Latest appropriations cycle sustains fab buildout pace — continued NVDA demand visibility." },
  { d: 6, tick: "LLY", dir: "bullish", conf: 62, open: true, entry: 845, spyIn: 545, cat: "Drug pricing carve-out amendment", type: "bill_stage", thesis: "Amendment narrows the negotiation list — partial relief for affected franchises." }
];

const events = [];
let prevHash = GENESIS;
let seq = 0;
const now = Date.now();

function push(partial) {
  const base = { ...partial, seq, prevHash };
  const hash = hashEvent(prevHash, base);
  events.push({ ...base, hash });
  prevHash = hash;
  seq++;
}

for (const s of SAMPLES) {
  const createdAt = new Date(now - s.d * 86400000).toISOString();
  const horizonDays = 30;
  const horizonEndsAt = new Date(now - s.d * 86400000 + horizonDays * 86400000).toISOString();
  const id = "pred_" + createHash("sha256").update(s.tick + s.d + s.cat).digest("hex").slice(0, 12);

  push({
    type: "prediction", id, createdAt, ticker: s.tick, benchmark: "SPY", direction: s.dir,
    horizonDays, horizonEndsAt, thesis: s.thesis,
    catalyst: { type: s.type, id: null, title: s.cat },
    confidence: s.conf, predictedMagnitudePct: null,
    entry: { price: s.entry, benchmarkPrice: s.spyIn, source: "sample", at: createdAt },
    methodologyVersion: "ledger-1.0", origin: "sample:seed", sample: true
  });

  if (!s.open) {
    const tickerRet = ((s.exit - s.entry) / s.entry) * 100;
    const benchRet = ((s.spyOut - s.spyIn) / s.spyIn) * 100;
    const excess = tickerRet - benchRet;
    const dirActual = excess > DEADBAND ? "bullish" : excess < -DEADBAND ? "bearish" : "neutral";
    const hit = s.dir === dirActual;
    const p = s.conf / 100;
    const brier = (p - (hit ? 1 : 0)) ** 2;
    const r = (n) => Math.round(n * 1000) / 1000;
    push({
      type: "resolution", id, ticker: s.tick, resolvedAt: horizonEndsAt,
      exit: { price: s.exit, benchmarkPrice: s.spyOut, source: "sample", at: horizonEndsAt },
      resolutionLagMs: 0,
      tickerReturnPct: r(tickerRet), benchmarkReturnPct: r(benchRet), excessReturnPct: r(excess),
      directionActual: dirActual, hit, brier: Math.round(brier * 10000) / 10000, sample: true
    });
  }
}

await mkdir(join(ROOT, "data"), { recursive: true });
await writeFile(LEDGER_FILE, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
const resolved = events.filter((e) => e.type === "resolution");
const hits = resolved.filter((e) => e.hit).length;
console.log(`Seeded ${events.length} events -> ${LEDGER_FILE}`);
console.log(`  ${SAMPLES.length} predictions, ${resolved.length} resolved, ${hits} hits (${Math.round(hits / resolved.length * 100)}%)`);
console.log(`  All marked sample:true / origin:"sample:seed". Run with --wipe to clear before launch.`);

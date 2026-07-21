#!/usr/bin/env node
/**
 * Ops helper: force-heal a forked prediction ledger (multi-GENESIS residue
 * from ephemeral Railway redeploys) and persist the repaired chain.
 *
 * Usage:
 *   node scripts/heal-prediction-ledger.mjs
 *
 * Honors SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY and PREDICTIONS_FILE from
 * the environment (same as server.mjs). Does not start the HTTP server.
 *
 * Sets LEDGER_AUTO_HEAL=false so ensureLoaded() does not heal implicitly;
 * repairLedgerNow() performs the explicit heal + persist.
 */
process.env.LEDGER_AUTO_HEAL = "false";

import { repairLedgerNow, verifyLedger, _resetCacheForTest } from "../prediction-ledger.mjs";

_resetCacheForTest();
const before = await verifyLedger();
console.log("before:", JSON.stringify(before, null, 2));

if (before.ok) {
  console.log("Ledger already intact — nothing to heal.");
  process.exit(0);
}

const result = await repairLedgerNow();
console.log("result:", JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

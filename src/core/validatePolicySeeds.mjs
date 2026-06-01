import { listSeedValidationIssues, parseBillIdToCongressRef } from "./policySeedRegistry.mjs";

export async function validatePolicySeeds(bills, { congressApiKey = "", fetchFn = fetch } = {}) {
  const structural = listSeedValidationIssues(bills);
  const congressChecks = [];

  if (!congressApiKey) {
    return {
      ok: structural.length === 0,
      structural,
      congressChecks,
      skippedCongress: true,
      message: structural.length
        ? "Structural seed issues found."
        : "Congress.gov validation skipped (no CONGRESS_API_KEY)."
    };
  }

  const billsToVerify = bills.filter((b) => !b.scenarioOnly && (b.congressRef || parseBillIdToCongressRef(b.id)));

  for (const bill of billsToVerify.slice(0, 12)) {
    const ref = bill.congressRef || parseBillIdToCongressRef(bill.id);
    if (!ref) continue;
    const url = `https://api.congress.gov/v3/bill/${ref.congress}/${ref.type}/${ref.number}?format=json&api_key=${encodeURIComponent(congressApiKey)}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const resp = await fetchFn(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) {
        congressChecks.push({
          billId: bill.id,
          ok: false,
          status: resp.status,
          message: `Congress.gov returned ${resp.status}`
        });
        continue;
      }
      const data = await resp.json();
      congressChecks.push({
        billId: bill.id,
        ok: Boolean(data?.bill),
        title: data?.bill?.title || null,
        message: data?.bill ? "Resolved on Congress.gov" : "No bill object in response"
      });
    } catch (err) {
      congressChecks.push({
        billId: bill.id,
        ok: false,
        message: err?.message || "Congress.gov request failed"
      });
    }
  }

  const failedCongress = congressChecks.filter((c) => !c.ok);
  return {
    ok: structural.length === 0 && failedCongress.length === 0,
    structural,
    congressChecks,
    skippedCongress: false,
    message:
      structural.length || failedCongress.length
        ? `${structural.length} structural, ${failedCongress.length} Congress.gov failures`
        : "All checked seeds validated."
  };
}

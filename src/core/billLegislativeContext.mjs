/**
 * Plain-English legislative calendar context for retail-facing bill UI.
 */

function parseDate(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t) : null;
}

export function formatBillDate(value, { relative = false } = {}) {
  const d = parseDate(value);
  if (!d) return null;
  const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (!relative) return formatted;
  const days = Math.max(0, Math.round((Date.now() - d.getTime()) / 864e5));
  if (days === 0) return `${formatted} (today)`;
  if (days === 1) return `${formatted} (1 day ago)`;
  if (days < 60) return `${formatted} (${days} days ago)`;
  const months = Math.round(days / 30);
  return `${formatted} (${months} mo ago)`;
}

function daysSince(value) {
  const d = parseDate(value);
  if (!d) return null;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 864e5));
}

function parseCommitteesFromCongressPayload(payload) {
  const items = payload?.committees || payload?.items || [];
  if (!Array.isArray(items)) return [];
  return items
    .map((row) => {
      const committee = row.committee || row;
      const name = committee.name || row.name || "";
      if (!name) return null;
      const activities = row.activities || committee.activities || [];
      const latest = Array.isArray(activities) && activities.length ? activities[activities.length - 1] : null;
      const activityName =
        latest?.name || latest?.text || row.relationshipType || row.type || "Referred";
      return {
        name,
        chamber: committee.chamber || row.chamber || "",
        type: committee.type || "",
        activity: activityName,
        activityDate: latest?.date || row.actionDate || row.date || null
      };
    })
    .filter(Boolean);
}

function committeesFromStakeholders(stakeholders) {
  const rows = stakeholders?.committees || [];
  return rows.map((c) => ({
    name: c.name || "",
    chamber: "",
    type: c.role || "",
    activity: c.stance === "stalled" ? "Stalled in committee" : c.role || "Committee gatekeeper",
    activityDate: null
  }));
}

function inferCommitteeFromAction(text) {
  const s = String(text || "");
  const m = s.match(/committee on ([^.;]+)/i) || s.match(/referred to (?:the )?([^.;]+committee)/i);
  if (!m) return null;
  return m[1].trim().replace(/\s+/g, " ");
}

function buildVoteWatch(bill, statusInfo) {
  if (bill.floorScheduled) {
    return {
      label: "Floor vote watch",
      detail: "This bill has floor-calendar signal. Chamber leaders can still delay or pull the vote.",
      confidence: bill.exactCongressRecord ? "Medium" : "Modeled"
    };
  }
  const key = statusInfo?.key || "";
  if (key === "enacted") {
    return { label: "Signed / enacted", detail: "Passage risk is mostly done — watch agency rulemaking and funding.", confidence: "High" };
  }
  if (key === "passed_one_chamber" || key === "resolving") {
    return {
      label: "Cross-chamber vote ahead",
      detail: "One chamber passed it; the other chamber or conference is the next vote risk.",
      confidence: bill.exactCongressRecord ? "Medium" : "Modeled"
    };
  }
  if (key === "floor" || key === "reported") {
    return {
      label: "Floor scheduling possible",
      detail: "No exact vote time is posted on Congress.gov until leadership schedules it.",
      confidence: "Low"
    };
  }
  if (key === "markup" || key === "committee") {
    return {
      label: "No floor vote scheduled",
      detail: "Still in committee process — hearings, markup, or a committee vote would come first.",
      confidence: "High"
    };
  }
  return {
    label: "No vote scheduled",
    detail: "Most bills never reach a floor vote. Watch committee movement and cosponsor growth first.",
    confidence: "High"
  };
}

function buildNextMilestone(bill, statusInfo) {
  const committees = bill._committeeNames?.length ? bill._committeeNames.join(", ") : null;
  if (bill.floorScheduled) {
    return {
      label: "Watch for chamber floor vote",
      detail: `${bill.chamber || "Chamber"} floor calendar — amendments can change the market impact.`,
      committee: committees
    };
  }
  const key = statusInfo?.key || "introduced";
  const map = {
    introduced: {
      label: "Committee referral",
      detail: committees
        ? `Gatekeeper: ${committees}. A hearing date is the first real catalyst.`
        : "Wait for which committee receives the bill and schedules a hearing."
    },
    committee: {
      label: "Committee hearing / markup",
      detail: committees
        ? `${committees} controls the next step.`
        : "Committee must hold a hearing or markup before a floor vote is realistic."
    },
    markup: {
      label: "Committee vote to report",
      detail: "If the committee reports the bill favorably, floor scheduling becomes possible."
    },
    reported: {
      label: "Floor scheduling",
      detail: "Leadership decides whether the bill gets floor time — often the slowest step."
    },
    floor: {
      label: "Chamber floor vote",
      detail: "Debate, amendments, and cloture (in the Senate) can delay or change outcomes."
    },
    passed_one_chamber: {
      label: "Other chamber or conference",
      detail: "Companion bill, amendment vehicle, or conference committee shapes final text."
    },
    resolving: {
      label: "Final passage vote",
      detail: "Conference report or final chamber votes — small language changes can matter."
    },
    enacted: {
      label: "Implementation deadlines",
      detail: "Agency rules, grant awards, and appropriations control timing for stocks."
    },
    incorporated: {
      label: "Vehicle bill movement",
      detail: "Track the larger bill carrying this language — the standalone bill may stall."
    },
    failed: {
      label: "Unlikely near-term vote",
      detail: "Issue may return in a different bill or spending package."
    },
    vetoed: {
      label: "Override vote or rewrite",
      detail: "Needs a supermajority override or a revised bill."
    }
  };
  const row = map[key] || map.introduced;
  return { ...row, committee: committees };
}

/**
 * @param {object} bill - decorated or raw bill
 * @param {object} statusInfo - from statusInfoForBill
 * @param {object} [options]
 * @param {object} [options.stakeholders] - POLICY_STAKEHOLDERS model
 */
export function buildBillLegislativeContext(bill, statusInfo = {}, options = {}) {
  const stakeholders = options.stakeholders || bill.stakeholders || null;
  let committees = Array.isArray(bill.committees) ? bill.committees : [];
  if (!committees.length && bill._committeeNames?.length) {
    committees = bill._committeeNames.map((name) => ({ name, activity: "Referred", chamber: bill.chamber || "" }));
  }
  if (!committees.length) committees = committeesFromStakeholders(stakeholders);
  if (!committees.length) {
    const inferred = inferCommitteeFromAction(bill.latestAction);
    if (inferred) committees = [{ name: inferred, activity: "From latest action", chamber: bill.chamber || "" }];
  }

  const introducedDate = bill.introducedDate || null;
  const latestActionDate = bill.latestActionDate || null;
  const voteWatch = buildVoteWatch(bill, statusInfo);
  const nextMilestone = buildNextMilestone(bill, statusInfo);
  const primaryCommittee = committees[0]?.name || nextMilestone.committee || "—";

  const timelineRows = [
    {
      key: "introduced",
      label: "Introduced",
      value: introducedDate ? formatBillDate(introducedDate) : bill.scenarioOnly ? "Scenario — date pending" : "Not posted",
      hint: introducedDate
        ? `${daysSince(introducedDate) ?? "—"} days since introduction`
        : "Congress.gov posts this when the bill is linked."
    },
    {
      key: "committee",
      label: "Committee",
      value: primaryCommittee !== "—" ? primaryCommittee : statusInfo.label === "In committee" ? "In committee (unnamed)" : "—",
      hint: committees.length > 1 ? `Also: ${committees.slice(1, 3).map((c) => c.name).join(", ")}` : committees[0]?.activity || "Committee controls hearings and markup."
    },
    {
      key: "last-action",
      label: "Last action",
      value: bill.latestAction ? String(bill.latestAction).slice(0, 120) : "—",
      hint: latestActionDate ? formatBillDate(latestActionDate, { relative: true }) : "No action date on file"
    },
    {
      key: "next",
      label: "What to watch next",
      value: nextMilestone.label,
      hint: nextMilestone.detail
    },
    {
      key: "vote",
      label: "Vote timing",
      value: voteWatch.label,
      hint: voteWatch.detail
    }
  ];

  if (bill.policyArea) {
    timelineRows.push({
      key: "policy-area",
      label: "Policy area",
      value: bill.policyArea,
      hint: "Congress.gov subject classification"
    });
  }

  return {
    introducedDate,
    introducedLabel: formatBillDate(introducedDate, { relative: true }),
    latestActionDate,
    latestActionLabel: formatBillDate(latestActionDate, { relative: true }),
    latestActionText: bill.latestAction || "",
    daysSinceLastAction: daysSince(latestActionDate),
    daysSinceIntroduced: daysSince(introducedDate),
    committees,
    primaryCommittee,
    committeeSummary:
      committees.length > 0
        ? committees.map((c) => c.name).filter(Boolean).slice(0, 2).join(" · ")
        : inferCommitteeFromAction(bill.latestAction) || "—",
    nextMilestone,
    voteWatch,
    timelineRows,
    floorScheduled: Boolean(bill.floorScheduled),
    chamber: bill.chamber || null
  };
}

export function parseCongressCommitteesResponse(data) {
  return parseCommitteesFromCongressPayload(data);
}

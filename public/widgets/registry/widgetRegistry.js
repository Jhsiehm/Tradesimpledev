import { CrsScoreCard } from "../types/crsScoreCard/CrsScoreCard.js";
import { AwardFeedItem } from "../types/awardFeedItem/AwardFeedItem.js";
import { PredictionLedgerRow } from "../types/predictionLedgerRow/PredictionLedgerRow.js";
import { Watchlist } from "../types/watchlist/Watchlist.js";

/**
 * Single source of truth: widget type → mount/defaultSize/sourceType.
 * Adding a widget = one folder + one entry here.
 */
export const widgetRegistry = {
  crsScoreCard: {
    type: "crsScoreCard",
    label: "CRS score",
    description: "Contract revenue signal on recent awards",
    sourceType: "trade",
    defaultSize: { w: 4, h: 4 },
    mount: CrsScoreCard.mount
  },
  awardFeedItem: {
    type: "awardFeedItem",
    label: "Contract awards",
    description: "USASpending significant award feed",
    sourceType: "contract",
    defaultSize: { w: 4, h: 5 },
    mount: AwardFeedItem.mount
  },
  predictionLedgerRow: {
    type: "predictionLedgerRow",
    label: "Prediction ledger",
    description: "Hash-chained calls vs SPY",
    sourceType: "legislation",
    defaultSize: { w: 4, h: 5 },
    mount: PredictionLedgerRow.mount
  },
  watchlist: {
    type: "watchlist",
    label: "Watchlist",
    description: "Pinned tickers with live quotes",
    sourceType: "trade",
    defaultSize: { w: 4, h: 5 },
    mount: Watchlist.mount
  }
};

export function listWidgetTypes() {
  return Object.values(widgetRegistry);
}

export function getWidgetDef(type) {
  return widgetRegistry[type] || null;
}

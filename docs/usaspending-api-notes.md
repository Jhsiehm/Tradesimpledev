# USASpending API — TradeSimple integration notes

Slim reference extracted from the upstream [usaspending-api](https://github.com/fedspendingtransparency/usaspending-api) Django repo (API Blueprint contracts under `usaspending_api/api_contracts/contracts/`). TradeSimple calls the **hosted public API** at `https://api.usaspending.gov` — no local Django stack required.

## Base URL

```
https://api.usaspending.gov/api/v2
```

No API key. Respect rate limits — TradeSimple caches responses in memory (`USASPENDING_CACHE_TTL_MS`, default 15 min).

## Endpoints used by TradeSimple

| Endpoint | Method | Purpose in TradeSimple |
|----------|--------|------------------------|
| `/search/spending_by_award/` | POST | Primary contract award pull by company name, keyword, or `recipient_id` |
| `/autocomplete/recipient/` | POST | Resolve ticker/company text → official recipient name |
| `/recipient/` | POST | Recipient search by keyword; returns `id` (hash-level) for award filters |
| `/awards/{generated_internal_id}/` | GET | Single award detail (description, agency, obligation, dates) |
| `/agency/{toptier_code}/budgetary_resources/` | GET | Agency budget totals by fiscal year |

## Contract award search (`spending_by_award`)

**Request body (minimal):**

```json
{
  "filters": {
    "award_type_codes": ["A", "B", "C", "D"],
    "recipient_search_text": ["Palantir Technologies"]
  },
  "fields": [
    "Award ID",
    "generated_internal_id",
    "recipient_id",
    "Recipient Name",
    "Awarding Agency",
    "Award Amount",
    "Description",
    "Start Date",
    "End Date",
    "Contract Award Type",
    "NAICS",
    "PSC"
  ],
  "sort": "Award Amount",
  "order": "desc",
  "page": 1,
  "limit": 15
}
```

**Alternate filters:** `keywords`, `recipient_id` (hash-level id from `/recipient/`).

**TradeSimple row mapping (`mapUsaspendingAwardRow`):**

| API field | TradeSimple field |
|-----------|-------------------|
| `Award ID` | `awardId` |
| `generated_internal_id` | `internalId` + `directUrl` |
| `internal_id` (auto) | `numericId` |
| `recipient_id` | `recipientId` |
| `Recipient Name` | `recipientName` |
| `Awarding Agency` | `awardingAgency` |
| `Award Amount` | `obligatedAmount` |
| `Description` | `description` |
| `Start Date` / `End Date` | `startDate` / `endDate` |

**Direct award URL:** `https://www.usaspending.gov/award/{generated_internal_id}/`

## Recipient resolution flow

1. Known name from `COMPANY_ALIASES` or `FUNDAMENTALS[symbol].name`
2. `spending_by_award` with `recipient_search_text` / `keywords`
3. Fallback: `POST /recipient/` with `keyword`, `award_type: "contracts"`
4. Fallback: `POST /autocomplete/recipient/` → re-query `/recipient/` with matched name
5. Awards by `recipient_id` filter

## Award detail

`GET /api/v2/awards/CONT_AWD_…/` accepts `generated_unique_award_id` or numeric internal id.

## Agency budget

`GET /api/v2/agency/{toptier_code}/budgetary_resources/` — e.g. `097` for DoD.

## Env vars (Railway / `.env.local`)

| Variable | Default | Notes |
|----------|---------|-------|
| `USASPENDING_CACHE_TTL_MS` | `900000` (15 min) | In-memory cache TTL |
| `USASPENDING_FETCH_TIMEOUT_MS` | `14000` | Per-request timeout |

No API key required.

## Data lag (from USASpending / DoD guidance)

- DoD awards: up to ~90 days
- Other agencies: typically within 3 business days

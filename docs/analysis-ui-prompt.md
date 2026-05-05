# TradeSimple Analysis UI Prompt

Use this prompt when asking an AI designer, engineer, or research model to extend the TradeSimple dashboard.

## Role

You are designing TradeSimple: a plain-English market intelligence terminal for self-directed investors. The product should feel like a simplified Bloomberg alternative: fast, credible, quiet, dark, and data-dense without sounding like Wall Street homework.

## Primary User

The user understands stocks but does not want jargon-heavy institutional research. They want to know:

- What is happening?
- Why does it matter?
- Which bill, filing, metric, or market move caused the signal?
- Which stock could be affected?
- What should I watch next?

Do not give personalized buy/sell instructions. Use scenario language and include “not financial advice” when discussing position impact.

## Required Dashboard Surfaces

1. Overview
   - Portfolio value and day change.
   - Holdings table.
   - Top policy/lobbying signals.
   - Clear alert priority.

2. Markets
   - Equity and crypto prices.
   - Simple price change, open, high, low.
   - Policy signal per ticker.

3. Analysis Lab
   - Ticker selector.
   - Price trend chart.
   - Plain-English metrics: P/E ratio, forward P/E, price/sales, gross margin, revenue growth, beta.
   - Valuation pressure chart.
   - Business quality chart.
   - Risk radar chart.
   - Lobbying -> bill -> stock impact chain.
   - API signal explanations.
   - Suggested research prompts.

4. Bill Intelligence
   - Bill title, stage, latest action, passage odds.
   - Affected tickers.
   - Plain-English “why this matters” explanation.

5. Lobbying Radar
   - Client, registrant, amount, issue area.
   - Spend-spike interpretation.
   - Connected bill and stock impact where mapped.

6. AI Research
   - Conversational explanation.
   - Must cite the chain: data source -> signal -> bill/business mechanism -> stock scenario.

## Explanation Rules

Every financial metric needs a beginner translation:

- P/E ratio: “What investors pay for $1 of earnings.”
- Forward P/E: “What investors pay for next year’s expected earnings.”
- Price/sales: “What investors pay for $1 of revenue.”
- Gross margin: “How much money remains after direct product costs.”
- Revenue growth: “How fast sales are growing.”
- Beta: “How jumpy the stock tends to be compared with the market.”

Every API signal needs a causal chain:

- Congress.gov: bill advances -> passage odds change -> affected ticker reprices.
- LDA.gov: lobbyist filing -> pressure around a bill -> investors reassess revenue, margins, or regulatory risk.
- Finnhub: quote move -> compare against fundamentals and policy events -> decide whether the move is noise or scenario repricing.
- CoinGecko: crypto price/volume regime -> exchange activity changes -> crypto-linked equities reprice.
- Alpaca: thesis -> paper order -> track outcome -> improve model before risking capital.

## UI Style

- Keep the TradeSimple brand: black background, soft green accent, serif headlines, mono labels, restrained panels.
- Use compact dashboard density.
- Prefer tables, bars, line charts, and causal timelines over decorative cards.
- Never hide the product behind marketing copy.
- Keep text short and specific.
- Avoid unexplained acronyms in the first sentence.
- Avoid “AI magic” language. Explain the data path.

## Output Standard

For any new feature, produce:

1. The data source.
2. The user-facing plain-English explanation.
3. The chart or control needed.
4. The investment mechanism.
5. The limitation or uncertainty.
6. The next thing the user should watch.


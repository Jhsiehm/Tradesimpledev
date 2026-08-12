# TradeSimple Type System — Professional Remediation Prompt

Use this prompt with an engineer or coding agent to finish and guard the type-system unification. Paste as-is; it encodes root cause, architecture invariants, and acceptance criteria so roles cannot be mistaken again.

---

## Prompt

You are remediating TradeSimple’s fragmented typography. TradeSimple is a policy-to-markets intelligence terminal (vanilla JS, zero npm deps, `server.mjs` + `public/app.js` god files). Do not add frameworks or new font families without founder sign-off.

### Root cause (already diagnosed — do not re-litigate)

The product did not “choose” many fonts. Three parallel design tracks were stitched together:

1. **Canonical token contract** in `src/imports/design-tokens.css`: Fraunces / Geist / Geist Mono, with zone rules (landing = editorial moments; dashboard = terminal density).
2. **Landing / Manus consolidation experiments** (`docs/consolidation-blueprint.md` Phase 0 formerly prescribed Cormorant Garamond + Space Mono). Those stacks were hardcoded into `landing-cinematic.css` and **overrode** `--mono` / `--sans` after tokens loaded.
3. **Preview sandboxes** (`public/terminal-preview.html`, `public/dashboard-hybrid-preview.html`) using Cormorant / Outfit / Space Mono. Patterns from those files leaked into production CSS via copy-paste, plus leftovers: JetBrains Mono, IBM Plex Mono, DM Serif Display, Caveat (hand accent).

Secondary causes:

- Duplicate CSS surfaces (`assets/landing-cinematic.css` ↔ `public/landing-cinematic.css`; `/assets/*` URL maps to `public/` via `sendStatic`).
- Component CSS (`bill-card.css`, `stock-card.css`, `detail-pages.css`) redeclared `:root` font stacks instead of aliasing tokens.
- Dashboard used **serif for section chrome** (`.page-header h1`) while also using mono for labels — the visual “three templates stitched” effect.
- Google Fonts `<link>` tags loaded experiment faces the CSS no longer needed.

### Canonical contract (source of truth)

File: `src/imports/design-tokens.css`

| Role | Token | Face | Allowed surfaces |
| --- | --- | --- | --- |
| Data / chrome / labels / badges / tabs / tickers / timestamps / tables / buttons | `--font-data` (`--mono`) | Geist Mono | Landing + Dashboard |
| Sentences / body / helpers / form copy | `--font-ui` (`--sans`) | Geist | Landing + Dashboard |
| Hero / brand wordmark / AI brief prose | `--font-display` (`--serif`) | Fraunces | Landing heroes; brand; thesis/brief prose only |
| Handwriting accent | `--font-hand` | Caveat | Landing signature moments only |

**Hard rules**

- If it’s a **sentence**, it is not mono → `--font-ui`.
- If it’s **section chrome** on the dashboard (page headers, eyebrows, status pills, nav), it is mono → `--font-data`, not serif.
- If it’s an **AI brief / thesis sentence**, display is allowed → `--font-display`.
- Never hardcode: Cormorant Garamond, Outfit, Space Mono, JetBrains Mono, IBM Plex Mono, DM Serif Display, Patrick Hand in production CSS (`public/*.css`, `assets/*.css`, `src/imports/*.css` except comments in design-tokens).
- Always load `design-tokens.css` **before** other stylesheets.
- Prefer `var(--font-*)`; do not redeclare family stacks in component `:root` blocks — alias only (`--mono: var(--font-data)`).
- Preview HTML may keep experimental stacks **only** if marked `TYPE SANDBOX` and never copied into production CSS.

### Work already done (verify, don’t redo blindly)

- Tokens expanded with role docs + utility classes (`.ts-type-data`, `.ts-type-ui`, `.ts-type-display`, `.ts-type-hand`).
- Production CSS scrubbed of forbidden faces; aliases pointed at `--font-*`.
- Dashboard `.page-header h1` → mono uppercase chrome; `.portfolio-command h1` → Geist UI hero (not serif).
- Google Fonts loads trimmed on landing, dashboard, auth, manifesto, track-record.
- Preview HTML files bannered as sandboxes.
- `docs/consolidation-blueprint.md` Phase 0 no longer prescribes Cormorant/Space Mono.
- `.cursorrules` documents the type contract.

### Your remaining audit checklist

1. **Inventory** every `font-family` and every Google Fonts `family=` across `index.html`, `public/**`, `assets/**`, `src/imports/**`, and HTML emitted by `server.mjs`. Fail if any forbidden face appears outside sandbox HTML / design-tokens comments.
2. **Role audit on dashboard**: for each visible text style (section title, card title, body, chip, button, ticker, thesis), confirm the role→token table above. Mis-assigned serif on section chrome is a defect.
3. **Landing**: hero/manifesto may use display; terminal strips/labels must use data mono via tokens (not Space Mono). Hand accent only where intentional signatures exist.
4. **Sync discipline**: if you edit `public/landing-cinematic.css`, copy to `assets/landing-cinematic.css` (landing `index.html` loads root `assets/`; `/assets/` route serves `public/`).
5. **Server-rendered briefs** (`server.mjs` HTML for stock/bill/lobby/contract dossiers): ensure font links and CSS use the canonical trio only.
6. **Canvas / JS font strings** in `public/app.js` / charts: use `Geist` / `Geist Mono` (or CSS-computed styles), never JetBrains/Space Mono.
7. **Broader architecture guardrails** (so type isn’t the only thing that forks again):
   - Do not invent a second design-token file.
   - Do not split `app.js` / `server.mjs` without founder sign-off.
   - Treat preview HTML as non-shipping experiments.
   - When porting UI from a prototype, **map** its type roles onto `--font-display|ui|data` — never import the prototype’s font files into production.
8. **Acceptance tests**
   - `rg` for forbidden family names in production CSS/HTML returns only design-tokens forbid-list comments / sandbox HTML.
   - Landing + dashboard Network panel loads at most: Fraunces, Geist, Geist Mono, and Caveat (landing only).
   - Visual: dashboard section headers read as one terminal system; serif appears only on brand / brief prose.
   - `node --check` on touched JS; smoke-load `/` and `/dashboard` with design-tokens first in `<head>`.

### Deliverable format

- Short root-cause confirmation (2–4 sentences).
- Diff summary grouped by: tokens, production CSS, HTML font loads, docs/rules.
- Explicit list of any remaining intentional exceptions.
- Do not propose new font families.

---

## Quick verification commands

```bash
# Forbidden faces in production surfaces (should be empty aside from design-tokens comments / TYPE SANDBOX HTML)
rg -n 'Cormorant|Outfit|"Space Mono"|JetBrains|IBM Plex|DM Serif|Patrick Hand' \
  public assets src/imports index.html manifesto.html \
  --glob '!**/terminal-preview.html' \
  --glob '!**/dashboard-hybrid-preview.html'

# Font families requested from Google
rg -o 'family=[^&"]+' index.html public/*.html manifesto.html | sort -u
```

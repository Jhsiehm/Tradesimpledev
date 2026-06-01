# Railway setup (Tradesimpledev)

## Seeing README instead of the site?

The landing page is **`index.html`** at the repo root (CSS/JS still live under `public/` and `/assets/`).

TradeSimple is a **Node app** (`server.mjs`). At `/` the server serves root `index.html`. If you see **README.md** text, Railway is **not** running Node — common causes:

1. Service type is **Static Site** → delete it; use a **Web Service** connected to GitHub `Tradesimpledev`.
2. **Start command** missing → set to `node server.mjs` (or redeploy latest `main` with `railway.json`).
3. **Root Directory** wrongly set → leave blank (repo root, not `public/`).
4. You're viewing the **GitHub repo** page, not the Railway **public URL** (Settings → Networking).

After a good deploy, open your `*.up.railway.app` URL — you should see the dark TradeSimple landing with “Markets move when bills pass.”

## 1. Variables (required)

Run locally:

```bash
bash scripts/print-railway-vars.sh
```

Copy the output into **Railway → Tradesimpledev → Variables → Raw Editor**, then **Deploy**.

Or open `docs/RAILWAY_COPY_PASTE.env` (generated locally, gitignored) if you already ran setup once.

**Minimum keys:**

| Variable | Value |
|----------|--------|
| `AUTH_SECRET` | 32+ char random (not `replace-with-a-long-random-string`) |
| `DATA_ACCURACY_MODE` | `demo` for soft launch |
| `DEMO_AUTH` | `true` |

`APP_URL` is **optional** on Railway — the server uses `RAILWAY_PUBLIC_DOMAIN` when `APP_URL` is localhost or unset.

## 2. Remove bad suggested variables

Delete or overwrite any row still set to:

- `APP_URL=http://localhost:3000`
- `AUTH_SECRET=replace-with-a-long-random-string`
- `GOOGLE_CLIENT_ID=VALUE or ${{REF}}` (empty placeholders)

## 3. Google OAuth (after live URL exists)

1. Railway → **Settings → Networking** → copy public domain.
2. Google Cloud → OAuth client → redirect URI:

   `https://YOUR-DOMAIN/auth/callback/google`

3. Railway variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and optionally `APP_URL=https://YOUR-DOMAIN`.

## 4. Supabase

1. Run `supabase/schema.sql` in Supabase SQL editor.
2. Railway: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (service role, server-only).

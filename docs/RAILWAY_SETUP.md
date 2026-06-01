# Railway setup (Tradesimpledev)

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

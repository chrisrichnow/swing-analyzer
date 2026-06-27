# Swing Analyzer v2 — Deployment

Two services:
1. **Next.js app** (`swing-analyzer`, existing Fly app) — frontend + Claude grading.
2. **SwingNet ML service** (`swing-analyzer-ml`, NEW Fly app) — frame selection
   (auto-crop + trained event detection). Lives in `ml/golfdb/`.

The Next.js app reaches the ML service via `SWING_SERVICE_URL`.

## One-time: deploy the ML service
```bash
flyctl auth login                       # interactive, in a real terminal
cd ml/golfdb
flyctl launch --copy-config --no-deploy # creates the app from fly.toml (pick org)
flyctl deploy                           # builds Dockerfile, ships it
```
Note the app URL (e.g. https://swing-analyzer-ml.fly.dev). Cold-starts from zero
on the first request after idle (~10-30s for torch load); scales to zero when idle.

## Wire the Next.js app to it
```bash
cd ../..                                # back to repo root
flyctl secrets set SWING_SERVICE_URL=https://swing-analyzer-ml.fly.dev -a swing-analyzer
git push origin master                  # GitHub auto-deploys the Next.js app
```
For lower latency + no public exposure, use Fly private networking instead:
`SWING_SERVICE_URL=http://swing-analyzer-ml.flycast:8000` (keep the ML app's
http_service for build, or switch to internal-only).

## New domain (optional)
```bash
flyctl certs add yourdomain.com -a swing-analyzer
# then add the A/AAAA (or CNAME) records Fly prints, at your DNS provider
```

## Local dev
```bash
# terminal 1 — ML service
cd ml/golfdb && ../.venv/Scripts/python.exe -m uvicorn service:app --port 8000
# terminal 2 — Next.js (SWING_SERVICE_URL=http://localhost:8000 in .env.local)
npm run dev
```

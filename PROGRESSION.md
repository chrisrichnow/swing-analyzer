# Swing Analyzer — Progression Log

Auto-updated by git post-commit hook. Each entry = one commit.

---

## 2026-05-12 — Upgrade to Opus 4.7, stream SSE progress events
`189c102` — Upgraded analysis model to Opus 4.7. Added SSE streaming so the loading overlay shows real server-driven progress steps instead of a static spinner.

## 2026-06-14 — Make frame selection robust to uncut, real-world swing videos
`5b386fb` — Old selector required stillness before/after the swing to anchor P1/P10 — failed on range footage. New: impact-anchored geometric fallback, confidence scoring, and AI-mapping fallback (Sonnet) when confidence is low. Validated on an uncut range clip. Analysis model bumped to Opus 4.8.

## 2026-06-14 — Add visual impact (P7) refinement for unreliable motion-peak picks
`c855c53` — Pixel-diff motion peak has no consistent offset across angles/clubs/lighting — a fixed shift can't fix it. When P7 can't be trusted (low confidence, face-on angle, non-isolated peak), extract a dense full-fps strip and have Sonnet pick exact ball-strike. Face-on impact moved from P6 (1.48s) to dead-on the ball (1.55s). All 7 test clips produce clean, correctly-ordered positions.

## 2026-06-14 — Add PROGRESSION.md auto-log and fix local Supabase crash
`62d2c74`

## 2026-06-14 — Fix swing-position selection accuracy and speed up analysis
`8123575` — Killed the AI-mapping fallback (it was worse than math on every DTL clip), merged drills into the analysis call, downscaled scene detection, and added per-phase timing logs. Faster pipeline, more accurate frame picks.

## 2026-06-14 — Make impact (P7) and takeaway selection robust to real-world swings
`2536aff` — Always lock P7 visually with a "later-only" guard (fixes the false early motion-peak on DTL club-sweeps and the face-on early bias while keeping good math picks). Anchor takeaway detection on P4 and measure the backswing peak in the ~1.2s before it, skipping a long pre-shot routine/waggle that previously smeared P2/P3 onto the address frame.

## 2026-06-14 — Add pose-estimation frame selection (experimental, flag-gated)
`6d1258c` — Biomechanics-based selector tracking the wrists via MoveNet, immune to background motion. Gated behind USE_POSE_SELECTION=1 (default off). Hybrid impact: DTL refines P7 visually, face-on trusts pose. Backend auto-selects native tfjs-node (~10x) with WASM fallback. DTL validation nails all anchors on the historically-broken clip.

## 2026-06-14 — Add batch pose-selection validator across clip manifest
`19e52a3`

## 2026-06-26 — v2 frame selection: SwingNet inference service + auto-crop
`80e1894`

## 2026-06-26 — Weighted, deterministic overall score derived from per-position scores
`2cdc926`

## 2026-06-26 — Calibrate scoring rubric for honest amateur grading
`f9fefa6`

## 2026-06-26 — Exclude ml/ and test-videos from frontend Docker build context
`d2ef70b`

## 2026-06-26 — Fix batch-validate Club type + exclude dev scripts from prod build
`f425da9`

## 2026-06-26 — Downscale frames on read + bump ML service to 4GB (fix OOM)
`a4302b9`

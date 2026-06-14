# Swing Analyzer — Progression Log

Auto-updated by git post-commit hook. Each entry = one commit.

---

## 2026-05-12 — Upgrade to Opus 4.7, stream SSE progress events
`189c102` — Upgraded analysis model to Opus 4.7. Added SSE streaming so the loading overlay shows real server-driven progress steps instead of a static spinner.

## 2026-06-14 — Make frame selection robust to uncut, real-world swing videos
`5b386fb` — Old selector required stillness before/after the swing to anchor P1/P10 — failed on range footage. New: impact-anchored geometric fallback, confidence scoring, and AI-mapping fallback (Sonnet) when confidence is low. Validated on an uncut range clip. Analysis model bumped to Opus 4.8.

## 2026-06-14 — Add visual impact (P7) refinement for unreliable motion-peak picks
`c855c53` — Pixel-diff motion peak has no consistent offset across angles/clubs/lighting — a fixed shift can't fix it. When P7 can't be trusted (low confidence, face-on angle, non-isolated peak), extract a dense full-fps strip and have Sonnet pick exact ball-strike. Face-on impact moved from P6 (1.48s) to dead-on the ball (1.55s). All 7 test clips produce clean, correctly-ordered positions.

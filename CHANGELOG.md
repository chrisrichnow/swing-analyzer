# Changelog

_Auto-updated on every push to master. Newest first._

## 2026-06-14
- Make impact (P7) and takeaway selection robust to real-world swings
- Fix swing-position selection accuracy and speed up analysis
- Add PROGRESSION.md auto-log and fix local Supabase crash
- Add visual impact (P7) refinement for unreliable motion-peak picks
- Make frame selection robust to uncut, real-world swing videos

## 2026-05-11
- Upgrade to Opus 4.7, stream SSE progress events

## 2026-04-25
- fix(analyze): P4 detection works for fast-tempo swings without transition pause
- fix(analyze): separate P6 from P7 + reduce P7 backward shift
- fix(ui): drop CSS transition on bar (RAF restarts it 60x/sec, bar froze)
- fix(ui): use pure inline styles for loading bar (Tailwind h-2/h-full collapse the width)
- fix(ui): make loading bar gradient render (inline style instead of Tailwind arbitrary)
- chore: trigger CHANGELOG run for defensive batch (9f0d66b)
- feat(ui): full-screen loading overlay with animated golfer
- feat(ui): desktop dashboard layout
- fix(swing-analyzer): defensive batch — size/duration caps, frame-count hard-fail, JSON robustness, tmp cleanup

## 2026-04-24
- fix(analyze): detect true takeaway start to fix P2 placement
- fix(analyze): correct P2 (takeaway) and P7 (impact) placement
- fix(analyze): correct P4 detection + cumulative-motion P2/P3
- docs: mark TikTok scene-cut bug as fixed
- ci: add workflow_dispatch for manual trigger
- fix(analyze): handle scene-cut videos (TikTok overlays, edits)
- redesign home: premium dark + gold accent, Barlow Condensed display type
- rename header logo to "Golf Swing Analyzer"
- Replace frame extraction with anchor + cumulative-motion algorithm
- Add detailed P1-P10 visual cues to analysis prompt
- Fix swing window: walk forward to find motion onset instead of backward
- Fix swing window detection and increase filmstrip frame size
- Fix ffprobe/ffmpeg path, add Dockerfile and Fly.io config
- New files from Fly.io Launch

## 2026-04-23
- Initial commit — swing analyzer web app
- Build swing analyzer web app (Phase 2)
- Initial commit from Create Next App

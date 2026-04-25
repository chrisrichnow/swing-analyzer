# Changelog

_Auto-updated on every push to master. Newest first._

## 2026-04-25
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

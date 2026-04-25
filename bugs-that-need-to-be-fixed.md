# Bugs That Need To Be Fixed

Reference list of known + likely issues with the swing analyzer pipeline. Knock down one by one.

---

## Confirmed bug (from Rory TikTok video test)

**TikTok / scene-cut frame collapse.** When a video has hard scene cuts (TikTok loading screens, app overlays, edits), the per-frame grayscale diff at the cut is far larger than any swing motion. This poisons every threshold in `lib/analyze.ts:38-123` because they're all expressed as percentages of the global `maxDiff`:

- **P7** (impact) gets pinned to the scene cut (`lib/analyze.ts:60-64`)
- **P10** walks forward past the cut into the loading screen
- **P4** "last quiet < 15% of max" — inflated max means the entire held-finish pose qualifies as "quiet"
- **P1, P2, P3** all collapse into the same held-finish pose
- **P8, P9** land in the TikTok loading screens

End-to-end verified on Rory video: scene cut at t=5.5s, frames 1–7 all the same pose, frames 8–10 are TikTok loading bars.

**Fix:**
1. One-line: change `lib/analyze.ts:57` from `Math.max(...s)` to a 95th-percentile cap so single outlier frames don't poison thresholds
2. Robust: explicit ffmpeg scene-cut detection (`-vf "select='gt(scene,0.4)'"`) to crop analysis window to the longest cut-free segment
3. Sanity check: if `p10 - p1 < 1.0s` or `> 4.0s`, reject and fall back to evenly-spaced frames

---

## Likely to hit normal users

**1. Practice swings before the real swing.** A guy takes 1–2 waggles, then swings. The algorithm picks "last peak ≥ 80% of max" for impact (`lib/analyze.ts:62-64`) — usually fine, but if his practice swing is roughly the same speed as his real swing, P7 could land on the wrong one. Need to also require P10 to plateau into "quiet" *after* the chosen peak, and reject peaks where the post-peak motion never settles.

**2. Camera shake / handheld phone.** Code computes per-pixel grayscale diff across the entire 160×90 frame (`lib/analyze.ts:51-54`). If the person holding the camera is breathing or shifts their grip, the whole frame moves and the diff signal is flat noise — no clear peak. Algorithm fails silently (returns evenly-spaced frames or junk). Fix: compute diff on a center-cropped region, or downsample more aggressively to wash out small camera jitter. Mention "use a tripod" in the upload UI.

**3. Background motion.** Range buddies walking, kids in frame, trees blowing in wind, cars in the parking lot. Same issue as #2 — global diff signal includes everything. A person walking across the back will produce comparable motion to a swing.

**4. Slow-motion video (240fps iPhone).** The peak motion smears across many more frames, max diff per frame is *lower*, and a 1.5s real swing becomes 6s of footage. The 0.3s "quiet" window for P10 detection (`lib/analyze.ts:89`) is calibrated assuming roughly normal-speed footage. Need to either detect playback speed from frame metadata or scale windows by detected swing duration.

**5. Video too long / wrong format.** No file size or duration validation in `app/api/analyze/route.ts`. `execSync` has `maxBuffer: 200MB` for the raw frame scan — a 4-minute video at 60fps×160×90 = 207MB and crashes. A 500MB upload would also eat Fly disk in `tmpdir`. Need: max 30s, max 100MB, validate before processing.

**6. SessionStorage overflow.** `app/page.tsx:48` does `sessionStorage.setItem("swingResult", JSON.stringify(data))` with 10 base64-encoded JPEGs embedded. ~50KB × 10 = 500KB+. iOS Safari has a 5MB sessionStorage cap that's easily blown if frames are larger than expected. If it overflows, navigation to `/results` happens but the page is blank with no error. Fix: store frames server-side under the sessionId, fetch on results page.

---

## Less likely but real

**7. Claude returns non-JSON.** `cleanJson` only strips ` ```json ` fences (`lib/analyze.ts:238-240`). If the model prefixes "Here's the analysis:" or adds an apology, `JSON.parse` throws with the unhelpful message "Analysis failed." Make it a proper error, ideally with a retry.

**8. Frame extraction silently drops frames.** `lib/analyze.ts:138-145` runs ffmpeg per frame, checks `existsSync(framePath)`, but if ffmpeg fails on one timestamp (e.g., past video end) it just doesn't add that frame. Then `runAnalysis` runs on 7 or 8 frames instead of 10, and the prompt promises Claude exactly 10. Mapping breaks. Need: hard fail if `frames.length !== 10`.

**9. Tmp file leak.** `runAnalysis` removes `framesDir` only on success path (`lib/analyze.ts:343`). On any throw, the video file *and* frames stay in `/tmp/swing_*` forever. Fly machines have small disks and will fill up. Wrap in try/finally that always cleans `sessionDir`.

**10. No rate limiting / no auth.** Anyone can hammer `/api/analyze` and burn the Anthropic budget. A single Sonnet 4.6 vision call with 10 frames isn't cheap — a malicious script could rack up real money in a day. At minimum, add a per-IP rate limit.

**11. Camera angle mismatch.** User picks "Down-the-Line" but films face-on. Prompt instructions are wrong → wrong analysis but no error. Could auto-detect from video aspect ratio + cheap pose estimation, or at least warn.

---

## Recommendation — ship order

Before deploying the TikTok fix, also add:

- **#5** (file size/duration validation) — 5 lines, prevents disk fill and crashes
- **#6** (move frames server-side) — moderate change, but blank `/results` is the worst possible UX
- **#8** (hard-fail if not 10 frames) — 2 lines, prevents silent corruption
- **#9** (try/finally cleanup) — 3 lines, prevents Fly disk fill

#1–#4 are the kind of thing you fix after you see real failures in the wild. Don't pre-optimize. #10 (rate limit) matters once anyone besides you and Chris is using it.

**Ship plan:** TikTok fix (1+2+3 above) + #5 + #8 + #9, defer #6 unless concerned, watch real user behavior.

# Stage 3.8 browser smoke

Refs #40. ADR 0013 §7: "actual browser Optimize, Explore, Gunsmith, manifest/export, nullable status and floor smoke". Run on 2026-10-12
at commit `4d283a6`, by the orchestrator, in a real Chromium (Playwright, headless) against live tarkov.dev data (PvP).

- Dev server: `npm run dev` on port 5174.
- Production build: `npm run build`, then `vite preview` on port 5175, serving the pinned `highs.js` / `highs.wasm` from `dist/`.

The desktop app's built-in browser pane could not be used: the pane was hidden, so animation frames were paused, screenshots timed out and
antd's dialog close animation never finished. Playwright renders headless, so the smoke ran there.

## Results

| # | Area | Steps | Observed | Result |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Optimize, Auto, plain | M4A1, default weights | "最佳配装" (best build), `2965 ms · 自动选用 → 精确` (Auto → Precise). Details: "已证明最优" (proved optimal), bounds [14747, 14747], gap 1.9e-10 | PASS |
| 2 | Optimize, Auto, TrueErgo | M4A1, TrueErgo on | "已找到配装" (build found, not "best"), `自动选用 → 快速` (Auto → Fast). Details: approximate, not proved; Fast model; one copy per part; upper bound unknown | PASS |
| 3 | Explore | M4A1, ergonomics ↔ recoil, 10 targets (TrueErgo still on, so Auto → Fast) | Progress `8 / 9`, then complete: 10 of 10 targets with a verified build, 9 approximate points, curve "完整" (complete) | PASS, see note N1 |
| 4 | Gunsmith | Part 1 (MP-133) | `53 ms · 精确`, proved optimal, preset-based build, ergonomics exactly 45.0 against the ≥ 45 condition | PASS |
| 5 | Manifest copy | Copy button | "已复制到剪贴板" (copied to clipboard) | PASS |
| 6 | EFTForge export | EFTForge button | A new tab opens `https://www.eftforge.com?build=<lz-string>`, the same format as released v2.12. EFTForge itself redirected to its v2.0.0 release notes and the `?build=` parameter was gone | PASS, see note N2 |
| 7 | MOA floor | Max MOA on, precise floor off then on | "正在查找最低 MOA…" (finding the lowest MOA) with Cancel, then "最低 MOA：0.81" (lowest MOA 0.81), slider range 0.81–2.41, same in both modes | PASS |
| 8 | Advanced menu | Open Advanced | Precision Auto / Fast / Precise; allow repeated parts (greyed out under Precise, decision 2c); Sweet Spot | PASS |
| 9 | Cancel, nullable status | Advanced → Precise, M4A1 TrueErgo + MOA cap 0.89, cancel while solving | "已取消——显示目前已找到的配装" (cancelled, showing the build found so far). Details: valid build, not proved optimal; provisional MOA model; checked bounds [13104, 13338], gap 234. MOA 0.866 is within the cap | PASS |
| 10 | Locale | Switch to English, MP5 (Navy 3 Round Burst), TrueErgo, Precise | "Best build · 384 ms · Precise", "Proved optimal" with plain sentences. The language change reloads data and resets the weapon, as designed | PASS |
| 11 | Production build | `vite preview`, M4A1 plain | "最佳配装", `3903 ms · 自动选用 → 精确`, proved. Zero console errors or warnings | PASS |

Console on the dev server: 0 errors. The only warning is a recharts "width(-1) and height(-1)" notice during the first chart render
(cosmetic). The prices of the two M4A1 runs differ by ₽23 because the live market data was refetched between them; the build is identical.

Screenshots: `docs/stage3/smoke/smoke-01-m4a1-auto-precise.png`, `smoke-02-explore-m4a1.png`, `smoke-03-cancel-precise-ted.png`,
`smoke-04-preview-m4a1.png`.

## Notes for the verdict

- **N1 (wording), fixed:** the Explore Details showed the always-on line "every target has a verified build or is proved to have none" next
  to the curve status sentence, which contradicted "partial" mid-run and repeated "complete" afterwards. The line and its now-unused locale
  key `explore.coverage_all_resolved` are removed; the curve status sentence carries the meaning (`ExploreStatus.tsx`).
- **N2 (EFTForge), not a defect:** EFTForge still imports `?build=<lz-string>` for external sites (`app.js` `_checkUrlBuildParam`: it reads
  the parameter, removes it from the address so a refresh does not re-import, then calls `importBuildFromCode`), and its decoder still accepts
  the legacy LZ `{v: 1, g, p}` payload (`modules/build-codes.js` `decodeBuildCode`). The release-notes page was its "unseen news" overlay
  (`modules/news.js`), which opens automatically on a first visit in a fresh browser profile and covered the imported build. Checked
  read-only from EFTForge's public scripts on 2026-10-12.
- **N3 (wording), fixed:** the Details sentence for an approximate result no longer lists "the Fast model or the provisional MOA model"; it
  points to the labels beside the title, which name the actual cause (`results.authority_approximate_optimal_detail`, zh first, English in the
  other locales as before).

# Changelog draft for the correctness release

Draft only. It replaces the current `[Unreleased]` section of `CHANGELOG.md` at release time; the entries there describe fixes to `lpBuilder`,
which this release removes. Version per CLAUDE.md: a solver engine change is MAJOR, so `v3.0.0` unless the owner decides otherwise.

```markdown
## [v3.0.0] — YYYY-MM-DD

### Changed
- **New solver model**: Builds are now solved on a model of the real part tree, checked against an independent reference on every rule
  (slots, required slots, conflicts, presets, barters, stash, quantities, MOA, TrueErgo). Precise answers are proved optimal; the bigger guns
  (AK and M4 families) that used to time out now prove their best build in a few seconds.
- **Auto picks the mode for you**: Precise for every normal request. With TrueErgo or Prevent Overswing, the largest guns use Fast so the
  answer comes back in time; those results say "build found" and are marked approximate.
- **Plain results**: The result says "best build" only when it is proved. Anything else says what it is ("build found", "not proved"), and the
  technical detail (bounds, gap, model) sits in a collapsed Details section.
- **One copy per part in Fast**: Fast installs each part at most once unless you allow repeats.

### Added
- **Advanced menu**: Precision (Auto, Fast, Precise), allow repeated parts, and Sweet Spot.
- **Lowest MOA finder**: Turning on the MOA limit finds the lowest MOA the gun can reach and sets the slider range.
- **Cancel keeps the build**: Cancelling a search shows the best verified build found so far.

### Fixed
- A request could crash on some guns when the solver returned an internal error; it now retries and returns a result.
- Some searches could report a build as best when a better one existed, or call a weapon impossible when it was not. Every shown build is
  re-checked part by part, and "impossible" needs two independent confirmations.
- Prevent Overswing MOA searches stopped early with a wide range; they now finish.

### Removed
- The old LP builder and the npm `highs` package. The app uses one pinned HiGHS build.
```

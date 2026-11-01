# Fantasy League Explorer

A standalone, read-only fantasy-football chart with player usage/efficiency changes, center-of-mass improvement rankings, and ESPN projected team rankings.

## Views

- `/` is the original frozen October 31, 2026 snapshot. The weekly pipeline checks its checksum and never rewrites it.
- `/weekly/` is the latest validated weekly view.
- `/weekly/history.html` lists all published weekly snapshots. Older revisions remain available when a correction or roster/forecast update creates a new publication.

Statistics compare the 2025 baseline against fully official 2026 regular-season weeks. COM ranks historical improvement, not absolute roster strength or predicted wins. ESPN projected ranks are copied from ESPN, not computed by the COM model.

## Weekly updates

The GitHub Actions workflow checks Tuesday, Wednesday and Thursday at **06:37 UTC / 12:22 PM Nepal time**. Tuesday is the normal post-week refresh; subsequent checks allow for delayed results and stat corrections. Scheduled jobs can be delayed by GitHub. A manual run is available in Actions → Weekly league refresh and publish → Run workflow.

A week is included only if every scheduled game has `statsOfficial: true`, is in the past, and appears consistently in both participating teams' schedules. The cutoff stops at the first incomplete week. In-progress weeks are excluded from actual statistics and forecasts use the next three not-yet-started/remaining regular-season weeks. There are no regular-season forecasts after Week 18.

Rosters and available players reflect the time of each refresh. Archived snapshots do not reconstruct who owned a player during past games. Missing historical baselines are excluded from coordinates, not assigned zero improvement. Free agents are the top five per position by raw projected full-PPR total over the forecast window; injury status is displayed but projections are not independently injury-adjusted.

## Authentication and privacy

Only these repository Actions secrets are required:

- `ESPN_SESSION_S2`
- `ESPN_SESSION_SWID`
- `ESPN_LEAGUE_ID`

Session cookies grant account access. The collector makes **GET requests only**. It sends cookies only to ESPN league endpoints; public player statistics and schedules are fetched without cookies. No credentials, member/owner records, raw responses or private account metadata are saved to the repository or published artifact. Logs contain validation codes and summary counts, never session values or raw errors.

Secrets are retained for recurring reads, not committed to source. If the ESPN session expires, renew the secrets in repository Settings → Secrets and variables → Actions, then run the workflow manually. Do not paste session values into issues, source files or workflow logs. To stop updates, disable the workflow in Actions; delete the three secrets as well if access should no longer be retained. Secrets are not automatically renewed.

## Failure behavior

Authentication, schedule, coverage, numerical or rendering failures prevent publication; the last successful site remains available. A latest view older than eight days displays a stale-data notice. Scheduled jobs stop after a prolonged period of repository inactivity under GitHub's scheduling rules; check Actions if updates stop. GitHub failure notifications follow the repository owner's notification preferences.

The workflow is limited to trusted default-branch push, schedule and manual events; no pull-request event receives secrets. Third-party Actions are official GitHub actions pinned to exact commits. Only the refresh job can commit sanitized weekly files; deployment uses separate Pages permissions and never receives ESPN secrets.

## Development

Node.js 22 or later; no third-party Node packages are required.

```sh
npm test
npm run refresh  # requires the three session environment variables
npm run build
```

`tools/presentation.json` fixes the season and team color/abbreviation mapping. Move to a new season deliberately rather than silently changing the baseline. `tools/frozen.sha256` protects the original page. The public build contains only the original page, library/license assets and sanitized weekly views/data—not the collector or its environment.

Plotly.js 2.35.2 is bundled with its upstream copyright notice and MIT license in `LICENSE-Plotly.txt`.

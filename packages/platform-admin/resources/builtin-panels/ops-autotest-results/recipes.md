# Autotest results recipes

- **Inspect a specific test run**: Call `present` with `selected` set to the `platform:AutotestRun` reference (whose `primaryKey` is the `runId`).
- **Filter the test run list**: Call `present` with `search` set to a case set name, run ID, or status keyword; clear `search` to restore all runs.
- **Filter case results by verdict**: Call `present` with `verdict` set to `"all"`, `"correct"`, `"wrong"`, or `"abnormal"` to drive the `platform:AutotestRun.results` read.
- **Track an active run**: While a run is `running` or `stopping`, the owner automatically schedules silent 5-second rereads for the run list, run summary, and case results, and immediately syncs the left run list once the run settles; use the active-run banner **Refresh** button to pull immediately on demand.
- **Manage run retention**: Use the `runs` list inline row actions (`keep` / `unkeep`) or detail header `keepRun` / `unkeepRun` (`autotestRun.keep` / `autotestRun.unkeep`) to toggle retention protection.
- **Download or delete a run**: Invoke `downloadRun` (`autotestRun.download`) to export the run ZIP archive, or use the `runs` list delete row action / `deleteRun` (`autotestRun.delete`) to inspect impact and remove a non-running batch.
- **Open a case artifact**: Click any case result row to navigate to the `platform:AutotestCaseArtifact` panel (`caseDetailPath`, default `"/ops/autotest/case"`) with `selected` set to the encoded `runId::caseId` primary key.

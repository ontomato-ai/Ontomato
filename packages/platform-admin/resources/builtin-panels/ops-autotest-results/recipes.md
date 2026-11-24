# Autotest results recipes

- **Inspect a specific test run**: Call `present` with `selected` set to the `platform:AutotestRun` reference (whose `primaryKey` is the `runId`).
- **Filter the test run list**: Call `present` with `search` set to a case set name, run ID, or status keyword; clear `search` to restore all runs.
- **Filter case results by verdict**: Call `present` with `verdict` set to `"all"`, `"correct"`, `"wrong"`, or `"abnormal"` to drive the `platform:AutotestRun.results` read.
- **Refresh an active run**: Use the page header or active-run banner **Refresh** button to fetch the latest owner-computed summary metrics and case results.
- **Manage run retention**: Invoke `keepRun` (`autotestRun.keep`) to keep the selected run's artifacts or `unkeepRun` (`autotestRun.unkeep`) to remove the retention flag.
- **Download or delete a run**: Invoke `downloadRun` (`autotestRun.download`) to export the run ZIP archive, or `deleteRun` (`autotestRun.delete`) to inspect impact and remove a non-running batch.
- **Open a case artifact**: Click any case result row or its **Artifacts** row action to navigate to the `platform:AutotestCaseArtifact` panel (`caseDetailPath`, default `"/ops/autotest/case"`) with `selected` set to the encoded `runId::caseId` primary key.

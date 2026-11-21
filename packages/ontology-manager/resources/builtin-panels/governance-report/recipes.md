# Read a knowledge governance report

This page shows one governance record's report: its summary and review progress, the findings the review
proposed, and the cited sources. It is read-only for people; recording or confirming findings belongs to the
governance review itself, not to this page.

- The open record is the panel's `record` state (a `platform:KnowledgeGovernanceRecord`). The finding the
  reader selected is `issue`, a child of the record's `issues` collection. Both travel in the address's
  `state`, so a link such as `/governance/reports?state={"record":{…},"issue":{…}}` opens exactly that record at that
  finding.
- To discuss a finding, read it from the page context's selected issue. The issue rows carry the problem,
  the current description, the proposed change and the basis; the finding's cited sources are the
  `issueSources` read bound to that issue.
- A source's text is the `sourcePage` read: pass the source (a child of the record's `sources` collection)
  and page with `cursor` for a long source.

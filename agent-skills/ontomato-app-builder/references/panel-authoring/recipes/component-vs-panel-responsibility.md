# Component vs. panel responsibility

- **Display belongs to universal components.** Components render business fields, graphics, options, and executable
  operations according to their projection declarations. Note that `bindsElement` in the SDK catalogue indicates which
  ontology element types a component applies to; every actual projection binding must still go through a declared read
  or operation (binding a class alone is rejected).
- **Logic belongs to the capability layer; formatting belongs to components.** Calculations, aggregations, and business
  judgments (such as "overdue if > 3 days") belong to MetricViews (reads), Actions (writes), or platform built-in reads.
  Base components may format already-provided values in three ways only:
  1. **Owner gives numbers, component fills a fixed sentence template:** bind a MetricView (`data.result`) or record to
     `RecordTemplate` (`template: "共 {total} 人，其中 {pending} 人待审"`).
  2. **Exact-match `valueMap`:** map already-provided codes/booleans/statuses to localized `label` / `labelKey` /
     `labels`, semantic `tone`, and platform `icon` on `TypedValue`, `RecordTemplate`, `InfoBanner`, or `ObjectList`
     columns (pure exact match; no arithmetic or range/threshold expressions).
  3. **Local text matching on a complete unpaged list:** `ObjectList` filters an unpaged `panelRecordList` locally and
     exposes `filteredCount`. For paged reads (`panelRecordQuery`) or business-scoped filters, always use owner reads
     and the owner-returned `total`.
- **Panels only lay out and wire.** Panels arrange members, own layout and public state, wire read-only projection
  outputs (`usePanelOutput` / `usePanelOutputs`) into other projections, visibility checks (presence, equality, or zero
  checks are NOT business calculation), navigation, or text-only slots (titles, tabs, counts with optional fixed
  prefix/suffix). Never read raw record fields or compute business values; unsaved form drafts do not count as ontology
  data.

### Choose an official component before writing one

Advance to the next step only when the previous step cannot meet the need:

1. **Default appearance.** Run `panel type <type-id> --read <name>` and compare `result` / `resultSchema` with the
   official component's Data section in `sdk read docs/components/<ComponentId>.md` (find candidates in `sdk read docs/components.md`).
2. **Component `config`.** Configure columns (`width`, `minWidth`, `kind`, `valueMap`, `timeFormat`), `rowActions`,
   visible/copyable fields, `ObjectForm` `presentation` (`"cards" | "tabs" | "steps"`) & `groups`, `OperationButton`
   labels/tones/`hideWhenUnavailable`, or `pageSize`.
3. **Official component Vue slots.** Place a focused slot-only domain component (declared in `manifest.components`) or a
   nested `<projection :inputs="{ target: ref }">` inside `#cell-<key>`, `#actions`, `#row-detail`, or `#field-<dotPath>`.
4. **Author a dedicated domain component (last resort).** Only when steps 1–3 cannot cover the whole block, register a
   domain component with `component register <directory>` and declare its `meaning`, data, config, inputs, outputs, and
   operations. Never wrap an entire page in a custom component.

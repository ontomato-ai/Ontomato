---
name: ontomato-book-ontology-builder
description: "Build a book-specific ontology for Ontomato from full reading, with precise properties, property-specific evidence and meaningful analysis. Deliver one ontology Excel, one readable Markdown guide and a matching import package. Use with ontomato-ontomap-builder for deployment, not for ordinary book summaries."
---

# Book ontology builder

Explain what makes this book distinctive through a sourced, queryable model. Deliver **one ontology Excel, one readable Markdown design guide and one matching Ontomato import package** from the same accepted version. All required workflow rules are here; use the [guide template](#markdown-guide-template) when writing the Markdown. No bundled scripts, CLI or historical catalogues are required.

## Ontomato: work through one ontology

Ontomato is an ontology platform: it describes a domain and uses that shared meaning to connect data and answer questions.

| Concept | Meaning |
| --- | --- |
| Class and object | A class describes an object type; an object is one instance, identified by its primary-key value. |
| Attribute | A named property with a type and business meaning. Display names and descriptions explain a field; they do not replace its technical name. |
| Relationship | A directed connection with one meaning, such as Character **belongs to** Faction. Direction is part of the meaning. |
| ontomap | The machine-readable definition of classes, attributes, relationships and their data mappings. It describes the data; it is not the records themselves. |
| Evidence | Exact source passages and property-specific links identifying support, contradiction or context, with attribution and limits. |
| Analysis | A sourced judgment about a record: conclusion, reason, limits and method. It is data, not commentary kept outside the workbook. |

Maintain **one accepted ontology** across Excel, the guide and Ontomato. The final Excel is the authoritative import specification: classes, properties, records, IDs, relationships, evidence, analysis and uncertainty must correspond 1:1. Explicit naming and lossless storage conversions may differ (§7); import must not silently add, omit or change meaning.

## This skill's role

Own the path from source text to an accepted ontology and matching import package: read the declared scope, derive the smallest useful model, retain evidence and analysis, and prepare the synchronized deliverables.

This skill does **not** connect data sources, create business tables, replace an ontomap, upload resources or run questions. Those are deployment actions with their own authorization and verification rules; `ontomato-ontomap-builder` owns them. This package ships no `ontomato.mjs` and no `application.yml`; do not vendor a second client.

## Prerequisites

- The authoritative book files and the requested milestone.
- One recording language for names and prose, confirmed once per project.
- For import preparation: the target adapter's confirmed format and `ontomato-ontomap-builder` guidance. Actual deployment also needs Ontomato and an authorized data source. Identify missing prerequisites and report import readiness and deployment separately.

Reading can proceed independently. Use the companion builder's confirmed import rules when checking the initial sample; ask only for missing details needed to resolve its mappings.

## 1. Establish scope and read

- Identify the authoritative source, edition, volumes and requested milestone. Confirm the recording language once per project unless already explicit; apply it consistently while preserving original quotations and stable IDs. Reading can proceed while the language choice is pending.
- Preserve the original source and its hash. Check completeness, encoding/OCR, chapter order and meaningful material such as notes, tables and images. Record necessary normalization and unreadable content. Freeze the prepared text with stable chapter/paragraph locators; changed text requires affected span checks.
- Read the entire declared scope continuously from the beginning for an initial ontology, a redesign that replaces its central modeling questions, or an explicit fresh read or independent fresh verification. Collect provisional observations, then finalize the model. Summaries, search hits and old databases cannot substitute for this pass.
- Track reading separately from extraction; resume interruptions at the saved location. For follow-ups, new properties, local repairs and exports, reuse a reliable completed pass and existing data while reviewing affected source passages and dependencies. Read newly added source scope fully. For source changes, review changed passages and dependencies; reread the full scope when changes cannot be bounded reliably or prior reading coverage is unreliable. Never claim reused reading was newly performed.

## 2. Derive the smallest useful model

Start with a few book-specific questions and source-supported mechanisms, distinctions or transformations. Explain their centrality and how actual fields and directed joins answer the questions. For nonfiction, preserve the book's concepts, arguments, premises, objections, methods and reported observations. Do not impose a stock narrative catalogue or universal Event class.

Export only classes/properties that answer a book question, connect records, qualify an answer or verify evidence. Keep extraction decisions, review status, repair history and ID migration logs in the existing project review. Carry their substantive findings into the appropriate facts, relationships or judgments.

Keep one authoritative schema/dictionary:

- **Class:** name, plain definition, what one row represents, identity/boundary and membership rules, nearby exclusions, source examples and why this book needs it.
- **Property:** exact owner/key, question and meaning, value kind (fact, attributed claim, interpretation, derived or structural), type/cardinality, relevant vocabulary/unit, source cues, filling and missing-value rules, scope and evidence requirements. Check material rules on contrasting source cases; avoid generic boilerplate.
- **Reference:** endpoint classes/keys, direction, cardinality and qualifiers. Name the connection as a meaningful statement: source → relationship phrase → target. Define polymorphic discriminators and predicate-specific endpoint constraints.

Prefer properties or typed references on the correct scoped object. Create a separate relationship or assessment class only when independently varying occurrences, viewpoints, periods or methods require their own identity; explain what existing properties cannot preserve. Column count alone is not a reason.

Split parts or phases only when both a source-supported boundary and an independently useful distinction exist. Keep classification, composition, participation, ownership and membership distinct. Parent/subclass memberships share canonical identities and satisfy inherited rules; do not count them as separate occurrences. Apply consistent grain to comparable cases.

Make important filters, changes and joins structured; incidental context can remain supported prose. Preserve uncertainty, native quantities/units and time precision. Separate occurrence time from reporting time, attributed belief from established fact, intention from execution, capability from use, and immediate outcome from final objective. Later revelations do not give characters earlier knowledge. Do not invent reciprocal links, causal continuity, unnamed identities or considered alternatives.

Before bulk population, fix stable text primary keys and check the connected sample against §7's import mappings. Resolve required structural adaptations in the workbook model before scaling. Reuse confirmed platform rules; missing rules leave compatibility pending.

## 3. Keep evidence inside the ontology

Every final workbook and imported ontology includes **Evidence Passage** and **Evidence Support** as actual classes, with localized display names allowed.

An Evidence Passage identifies a complete contextual paragraph or contiguous paragraph group in the source, reconstructed from segments when necessary. Preserve exact wording, punctuation, whitespace, paragraph boundaries, source identity and locators. Reuse the same span rather than duplicating it. Declare its content as `vector`, while storing the complete original text in Excel; this does not generate or upload embeddings. Never substitute a summary, clipped quote or invented text. Split oversized spans at paragraph boundaries; if a single paragraph still exceeds cell capacity, use ordered, nonoverlapping segments retaining its source/paragraph ID and character offsets. Link supports to the complete logical passage, keep all segments in Excel, and verify their reassembly from exported cells exactly matches the source.

Each Evidence Support row identifies its own ID, target class/record, exact target property, passage, support role and necessary qualification (such as time, claimant or particular value). Leave the property blank only for a genuinely whole-record assertion. Distinguish support, contradiction and context: a record-level passage link does not prove every property, and context is not positive support.

Review each material value against full passages for identity, attribution, timing, scope and meaning. Evidence that someone made a claim does not establish the claim's truth. Where speech is modeled, preserve speaker continuity, nested quotation and speech/thought distinctions; account for relevant expression candidates without inventing turns at each paragraph break. Noncontiguous spans need an explicit assembly rule.

Preserve this many-to-many evidence model through import: a property may have multiple support rows, and a passage may support multiple targets. Keep each support's ID, target property/value, passage, role and qualifiers. Never replace these classes with one `evidence_id` per object; table or upload limits require a faithful mapping or unresolved import status.

## 4. Include meaningful analysis by default

Ontology creation and full extraction include source-grounded local analysis unless the user requests factual-only work. Do not wait for another analysis prompt. Explain choices, mechanisms, tradeoffs or limits beyond paraphrasing facts; general class-design explanations do not substitute for analysis of actual records.

For each substantive class, identify useful analytical questions and their eligible scope. If analysis adds no value or lacks support, give a class-specific reason. If the question is handled elsewhere, identify the owning class/property and a demonstrated record or query. A repeated blanket exclusion is insufficient; separate analysis columns are not compulsory for every class.

Each accepted judgment must retain its **conclusion, case-specific reason, material assumptions/limits, precise target/property, applicable method and qualified evidence** in the workbook. Document shared methods once in visible property metadata; retain record-level method distinctions only when they affect interpretation. Keep multiple dimensions' reasons distinguishable and use the appropriate time/viewpoint. Preserve disagreement and unknowns; do not turn an attributed interpretation into an unqualified fact.

Numerical scores are optional. Use them only when degrees answer a meaningful question and evidence supports that precision. Analytical scores use the full **0–100** range, with every integer available rather than a few permitted anchors. Define the construct, comparison scope, endpoints, intermediate guidance, source cues and unknown handling; justify each value. Unknown is null, not zero or 50. Preserve source numbers in native units. Derived results declare inputs, formula, counting unit, denominator and missing-value handling; do not average incompatible dimensions or force a distribution.

## 5. Review coverage and completion

Use one compact project review, linked to definitions and evidence. For each central question or pattern, record the representation, query path, tested records, findings and limits. Distinguish **schema expressibility, sample population, extraction coverage and analytical coverage**. Record semantic verdicts from full-context source review; never infer “reviewed”, “supported” or zero pending from field presence, evidence existence, valid IDs or default flags. Unreviewed values remain pending.

**First backbone:** after full reading and before bulk population, present the scoped questions, classes/properties and connected source-backed examples to the user. Demonstrate a central query, a contrasting case and a meaningful unknown when available, using saved sample rows. Normally include 3–4 real instances per included class and the evidence/targets needed for closed joins; explain genuine scarcity, never invent or split records for a quota. Report **full first read / sample-populated backbone**; additional population may remain pending, but missing central demonstrations, unsupported values, essential missing analysis and broken joins block acceptance. Continue automatically if full extraction is authorized unless the user requests a review pause.

**Full extraction:** revisit the source systematically under the accepted model. In the project review, record reviewed/excluded/pending dispositions and corresponding records for every paragraph, including reviewed paragraphs that yield no records.

Apply these checks to the declared milestone:

1. **Verify blanks and their explanations.** Read relevant full passages, surrounding context, later clarifications and neighbouring fields. Check claims such as “not stated” or “no later occurrence” against the property's source/time scope, including aliases and related records. If prose supplies a missing structured value, reconcile it; create a supported target when necessary. Rejecting existing targets or writing an explanation does not prove absence. Source silence, inapplicability and genuine uncertainty may remain blank; retain concise, case-specific explanations of material blanks inside Excel. Document shared filling rules and blank conventions once in property metadata.
2. **Audit populated properties.** Reconcile material factual, attributed and analytical values by property as supported, qualified or unresolved, with counts and retrievable records in the existing review. Verify property-specific evidence supports the exact value, direction, role, time and attribution; valid IDs and exact quotations alone do not. Structural IDs and fixed metadata need no artificial citations; derived values require traceable inputs and methods.
3. **Reconcile records.** Compare structured fields, descriptions and related records, including repeated reports, later appearances, changed knowledge, outcomes and group/member counts. Check declared identity/grain and phase/viewpoint boundaries, not just unique IDs; check reference direction and target role, not just existence. Resolve contradictions or retain genuinely conflicting source claims with attribution.
4. **Test from source-derived expectations.** Select additional cases from every volume or substantive division, including a contradicting or near-miss case and legitimate unknowns. Independently establish expected values, targets, roles, state/time and claim boundaries from full source context before comparing with saved rows; never copy expected answers from the extraction. Execute property queries and actual joins against the delivered workbook; retrieving prepared prose does not demonstrate a join. Investigate unexpected agreement and uneven filling rates; counts are not proof.
5. **Close the affected scope.** For each defect, record the affected scope, correction and recheck result in the same review. Review the affected property/batch and downstream dependencies, then rerun earlier failed cases. Repairing one example or adding rows does not close the batch.

Check **analytical coverage independently**: selected questions, eligible records, completed/pending judgments and justified exclusions. Reconcile counts with retrievable records. Retrieve conclusions, reasons, limits, methods and source support; verify reasoning is case-specific and supported, rather than merely nonempty.

**Ontology acceptance gate (always):** record pass, pending, fail or justified not-applicable separately for **structure/export (§6), source/extraction coverage and analytical coverage**, with checked scope, results and remaining issues. Declare the milestone complete only when every applicable gate passes. Known omissions, unsupported material claims and unchecked material blanks block completion; verified uncertainty does not. Sample acceptance is not full extraction, and extraction completion cannot close pending analysis. New defects reopen the affected gate.

**Import readiness:** the saved package passes §7's Excel correspondence checks with no unresolved mappings. **Deployment acceptance:** the deployment skill completes the authorized import, reads back the model/data/evidence for reconciliation, and verifies the declared central questions. Report ontology acceptance, import readiness and deployment acceptance separately; creating files alone cannot establish deployment.

## 6. Deliver readable, verified files

### Excel

Use one sheet per accepted class, including evidence and any declared parents/subclasses. Each data row is an instance and each column a property. **关系表 is the sole non-class sheet**, using the confirmed language's equivalent name if needed. It maps every declared reference, including unpopulated variants, qualified/polymorphic endpoints and inheritance mappings: source class/property → relationship phrase → target class/property, with cardinality and qualifiers. Instance facts belong in class records.

| Row | Contents |
|---|---|
| 1 | Canonical property names matching the schema |
| 2 | Datatypes, including `vector` for original passage content |
| 3 | Short definitions and necessary method/interpretation guidance |
| 4 onward | Accepted instances; null remains blank |

Freeze the first three rows, wrap prose and use readable widths. Preserve IDs/source strings as text and numerical/boolean types correctly. Never interpret source text beginning with `=` as a formula. Give scalar references clickable targets and collections a clear sheet/key lookup; document lossless array/object serialization. Do not filter metadata rows as instances or truncate evidence/reasons. Keep duplicate views and helper tables outside the workbook.

### Markdown

Write for someone unfamiliar with the schema and chat. Localize and adapt the [template](#markdown-guide-template):

- Open with the purpose, why this book fits the chosen lens and concrete questions. Introduce recognizable examples before technical terms; put counts and process details later.
- Explain important choices as **book phenomenon → modeling choice → useful question**, including what separate relationship/assessment rows mean and why needed.
- Work through a central question using readable names, a supported finding, the connections that reveal it and remaining uncertainty. Then give minimal real IDs/fields for locating records, accepted reasoning and full evidence.
- Include a compact inline fenced Mermaid diagram using actual classes and labelled directed relationships. Label partial views and distinguish inheritance from composition.
- **After the diagram, include a table of every accepted class:** object class | plain-language explanation of one record | **all properties in exact Excel column order**. Include evidence/analysis classes. Explain shared ID/blank conventions once and identify the relationship map separately as a non-class sheet. Keep the explanatory prose and worked example.
- Give short navigation instructions, source/milestone and material limits. Report reading, extraction and analysis separately; distinguish supported unknowns from unfinished work. Keep detailed audits internal.

### Final checks

Apply §2's usefulness test to every exported class/property; remove bookkeeping-only content. Check keys, types, vocabularies, cardinalities, references, inheritance/identity, relevant cycles, exact evidence spans and analytical support. Compare exported class sheets, headers, types, IDs and values with the accepted data; reconcile the Markdown inventory and relationship map with the workbook. Walk an actual central query through records → property-specific support → full source, including analysis and a meaningful unknown when available. Inspect workbook presentation; preview Mermaid when a renderer is available and state any rendering limitation. Read the guide independently for clarity.

Use these results in the §5 acceptance gates. Preserve earlier releases and deliver the workbook, guide and import package together with their exact milestone, material changes and remaining limits. Successful export does not establish source, analytical or deployment acceptance.

## 7. Ontomato mapping and import

Derive the ontomap, import files and evidence manifest from the same accepted schema and data as the final saved Excel. Check mappings on the initial sample; finalize the package after ontology acceptance. Later changes reopen affected checks.

### 1:1 correspondence

| Excel content | Required correspondence in Ontomato |
| --- | --- |
| Class sheets and instance rows | Same classes, record grain, ID sets and values. |
| Properties and definitions | Matching attributes/references, types, units, null meaning and interpretation rules. Preserve shared analytical methods in visible metadata. |
| Relationship map and reference values | Same predicates, endpoints, direction, multiplicity and instance links, including their qualifiers. |
| Evidence Passage | Same passage IDs, source locators and exact text; storage resources remain bound to those records. |
| Evidence Support | Same support IDs, exact targets/properties, passages, roles and qualifiers; all links remain navigable. |
| Analysis and uncertainty | Same conclusions, reasons, limits, attribution, methods and justified unknowns. |

Excel rows 1–3 become schema metadata; the relationship map becomes relationship definitions, not extra object rows. Presentation settings need no database equivalent. Declare physical-name, serialization and resource-storage conversions and decode them for comparison.

Any required structural adaptation must appear in the Excel class sheets, relationship map and guide before final export. Do not add runtime-only ontology classes/properties, omit accepted content or treat documented information loss as success. If no faithful mapping is available, identify the affected construct/questions and keep import readiness pending.

### Names and identity

- Use safe ASCII snake_case physical identifiers and a project prefix for table names. Keep the recording language in display names and descriptions; follow the target adapter's confirmed identifier rules.
- Maintain one map from Excel classes/properties to physical names and display names. Apply it consistently to references and evidence target class/property fields.
- Every class has one stable, non-empty text primary key already present in Excel. Use the companion builder's confirmed key declaration; do not generate replacement IDs during import or derive them from row order.
- Physical renames require explicit mappings and migration checks; they do not by themselves change object identity.

### Relationships and structural adaptations

Map every declared reference with its actual predicate, join fields, direction and multiplicity. For polymorphic targets, constrain joins by target class through a confirmed discriminator-aware or typed mapping; an ID match alone must not join the wrong class. Keep the complete Evidence Support class and its target identity.

If time, claimant or another qualifier varies per relationship occurrence, retain it on that scoped relationship record. Do not move it to a single field on the source object. Any required association classes or typed endpoint fields must already be represented in the final Excel.

When native inheritance or multi-value support is unavailable, adapt the workbook model using faithful class/relationship records or explicit membership discriminators. Preserve canonical identity and membership rules. Serialized lists are suitable only when display is sufficient and decoding is lossless; values needed for joins require queryable structure. Never create numbered columns such as `member_1`, `member_2`.

### Evidence storage

- Excel retains the complete original text in the `vector`-typed content property. Storage references must not replace that text in Excel.
- Use the companion builder's confirmed resource format. Cover every non-empty passage or declared segment exactly once in the upload manifest, with its stable class/property/object binding. Preserve logical-passage links and segment order; reassembled text must match Excel and the source.
- Retain property-specific Evidence Support records independently of resource storage. Retrieval must follow target → support → passage, including multiple passages, contradictions and qualified claims.
- Upload, embedding configuration and retry handling belong to the deployment skill. Verify existing bindings before retries so references are not duplicated; a resource success message alone does not prove exact content or correct attribution.

### Handoff package

Create `ontomato/` beside the workbook:

| Artifact | Contents |
|---|---|
| `ontomap.draft.json` | Matching classes, attributes, metadata, primary keys and relationship definitions. |
| `ddl.sql` | Non-destructive table/index definitions for the confirmed adapter, matching the workbook classes and keys. |
| `import/<class>.csv` | One file per class with mapped headers, identical records and explicit lossless type/null/list encoding. |
| `upload-manifest.jsonl` | Exact evidence text and stable resource bindings, including any declared segments. |
| `import-map.md` | Name/type/storage mappings, readiness results and unresolved prerequisites. Keep repair history and detailed audits in the existing project review. |

Read the saved Excel and package independently. Reconcile class/property inventories, metadata, full ID sets, values and nulls in both directions; compare relationship links/qualifiers, support targets and exact evidence text after decoding. Check manifest coverage and duplicate bindings. Counts alone are insufficient; any unexplained addition, omission or value change blocks readiness.

### Deployment verification

Hand the package to `ontomato-ontomap-builder`; this skill does not execute deployment commands.

- The deployment skill must save the current domain definition and confirm the intended replacement scope before writing. A table prefix does not isolate a whole-domain ontomap replacement.
- After import, read back the actual model, records and evidence resources and repeat the Excel reconciliation above. Check model metadata as well as data, preserving shared methods and blank semantics.
- Execute the declared central questions through actual imported records and evidence. Include multiple supports and a meaningful unknown or conflicting claim when available. Verify returned values, supporting record IDs, attribution and time scope; a plausible answer alone is insufficient.
- Unresolved differences, unavailable readback or unsupported required questions keep deployment acceptance pending. Never place credentials or tokens in the workbook, guide or package.

## 8. Continue without rebuilding

For follow-ups, test the current model/data first. Distinguish missing population, missing query, schema limitation and source uncertainty; make the smallest faithful change. Compare retained IDs and assertion meanings with the **immediately preceding published export**, including IDs first issued there. Persist newly allocated IDs independently of row/sort order; retire changed identities with explicit mappings instead of reassigning or reusing IDs. Preserve user edits and history, documenting changed meanings or language. Recheck affected evidence, definitions, queries and guide examples together. Existing project layouts need no migration merely to follow this skill.

When an import package or deployed ontology exists, recheck §7 correspondence after affected changes, including name mappings, keys, relationship endpoints and evidence bindings. Record migrations explicitly; preserve stable object identities.

While work remains, keep a short `CONTINUE_HERE.md` with source/pass, accepted versus draft work, versions, next location, unresolved issues and latest checks. Reuse existing review files instead of creating parallel registries.

Invoking the skill does not authorize unrelated project changes, delegation, uploads or background work.

## Markdown guide template

Use the following outline for the companion guide. Replace its placeholders with the book-specific content required by §6. State ontology acceptance, import readiness and deployment separately.

````markdown
# {{Book title}} — Ontology design guide

{{Purpose, why this book fits the chosen lens, and concrete reader questions.}}

[Open the ontology Excel]({{Workbook filename}})

## Why these objects and properties

{{Recognizable book examples → design choices → useful questions.}}

## A worked example

{{Question, situation, supported finding, connections and uncertainty. Follow with minimal actual IDs/fields for finding the evidence and analysis.}}

## How the model connects

{{Inline fenced Mermaid diagram of the explained path, with actual classes and labelled directed relationships.}}

## Objects and properties

| Object class | What one record represents | All properties in Excel column order |
|---|---|---|
| {{Class}} | {{Plain-language explanation}} | {{Complete ordered property list}} |

{{Shared ID/blank conventions; identify the relationship map as a non-class sheet.}}

## How to use the workbook

{{Entry point and short path through records, property support and full passages.}}

## Ontomato handoff

{{Package location, the 1:1 Excel/Ontomato mapping and necessary storage conversions; import readiness, deployment status and any unresolved prerequisites.}}

## Scope and limits

{{Source, milestone, separate reading/extraction/analysis coverage, remaining work and material uncertainties. Distinguish facts from analysis and explain scoring if used.}}
````

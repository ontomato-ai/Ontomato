import { computed, inject, type ComputedRef } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelRowOperationsMap } from "@ontomato/contracts/panel-host";
import { authoredReadParameterSource, directReadDeclaration } from "@ontomato/contracts/panel-projection";
import { panelContextKey } from "../panel/context";
import type { MemberInputs } from "../panel/direct";
import { useMember, useMemberData } from "../panel/member";
import type { MemberDataState } from "../panel/member-data-state";
import type { PlatformObjectRecord } from "../panel/platform-objects";

/**
 * Single-shot cap for customer `ObjectType.query` reads. Neither Node (`customer-reads.ts`) nor Java
 * (`DataServiceImpl.java`) imposes a hard page-size cap on customer queries; 1000 covers normal trees, record graphs,
 * and grouped grids in one request while preventing unbounded payloads.
 */
export const COLLECTION_CUSTOMER_LIMIT = 1000;

/**
 * Single-shot cap for platform `panelRecordQuery` reads. Several platform catalogue queries (for example
 * `Application.query`, `Panel.query`, `Projection.query`) validate `size` / `page.size` with `.max(100)`.
 */
export const COLLECTION_PLATFORM_LIMIT = 100;

/** Honest coverage summary for a collection datum (`panelRecordList` or `panelRecordQuery`). */
export interface CollectionCoverage {
  /** True when the owner returned the full collection without truncation. */
  readonly complete: boolean;
  /** True when more records exist on the owner than were loaded. */
  readonly truncated: boolean;
  /** Number of records loaded in this answer. */
  readonly loaded: number;
  /** Total records reported by the owner when known, else `null`. */
  readonly total: number | null;
  /** Owner-supplied non-fatal diagnostics (for example unreadable items). */
  readonly diagnostics: readonly string[];
}

export interface ParsedCollectionRecords {
  readonly rows: readonly PlatformObjectRecord[];
  readonly coverage: CollectionCoverage;
}

export interface CollectionDataHandle {
  /** Datum state for `<DataState>` (normalizes an empty non-truncated `panelRecordQuery` to `{ status: "empty" }`). */
  readonly state: ComputedRef<MemberDataState>;
  /** Loaded records from either `panelRecordList` or `panelRecordQuery`. */
  readonly rows: ComputedRef<readonly PlatformObjectRecord[]>;
  /** Per-row operation availability reported by the owner, if any. */
  readonly rowOperations: ComputedRef<PanelRowOperationsMap | undefined>;
  /** Coverage metadata for honest truncation notices and edit guards. */
  readonly coverage: ComputedRef<CollectionCoverage>;
}

const EMPTY_COVERAGE: CollectionCoverage = {
  complete: true,
  truncated: false,
  loaded: 0,
  total: null,
  diagnostics: [],
};

/** Parses either a plain `panelRecordList` array or a `panelRecordQuery` page object into rows and coverage. */
export function parseCollectionRecords(value: unknown): ParsedCollectionRecords {
  if (Array.isArray(value)) {
    const rows = value as readonly PlatformObjectRecord[];
    return {
      rows,
      coverage: {
        complete: true,
        truncated: false,
        loaded: rows.length,
        total: rows.length,
        diagnostics: [],
      },
    };
  }
  if (value && typeof value === "object") {
    const record = value as {
      rows?: unknown;
      total?: unknown;
      hasMore?: unknown;
      nextCursor?: unknown;
      diagnostics?: unknown;
    };
    const rows = Array.isArray(record.rows) ? (record.rows as readonly PlatformObjectRecord[]) : [];
    const total = typeof record.total === "number" && Number.isFinite(record.total) ? record.total : null;
    const hasMore = record.hasMore === true || (typeof record.nextCursor === "string" && record.nextCursor.length > 0);
    const truncated = hasMore || (total !== null && rows.length < total);
    const diagnostics = Array.isArray(record.diagnostics)
      ? record.diagnostics.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    return {
      rows,
      coverage: {
        complete: !truncated,
        truncated,
        loaded: rows.length,
        total,
        diagnostics,
      },
    };
  }
  return { rows: [], coverage: EMPTY_COVERAGE };
}

/**
 * Reads a collection datum (`panelRecordList` or `panelRecordQuery`) in a single request.
 *
 * When a `panelRecordQuery` read has no author-bound pagination parameters (`page`, `size`, `cursor`), requests up to
 * the owner's safe single-shot cap (`COLLECTION_CUSTOMER_LIMIT` for customer `ObjectType`, `COLLECTION_PLATFORM_LIMIT`
 * for platform reads) and exposes honest `coverage` when more rows exist on the owner.
 */
export function useCollectionData(
  name: string,
  options?: { readonly ignoreImplicitParams?: readonly string[] },
): CollectionDataHandle {
  const member = useMember();
  const panel = inject(panelContextKey, null);
  const datum = member.projection.data[name];

  let fixedParams: MemberInputs | undefined;
  if (datum) {
    const declaration = directReadDeclaration(member.projection, datum);
    const placement = panel?.manifest.members[member.key];
    const authorBoundPaging = Boolean(
      authoredReadParameterSource(datum.params, "page", placement)
      || authoredReadParameterSource(datum.params, "size", placement)
      || authoredReadParameterSource(datum.params, "cursor", placement),
    );
    if (declaration?.result === "panelRecordQuery" && declaration.parameterMode === "fixed" && !authorBoundPaging) {
      const limit = "type" in datum.source && datum.source.type.kind === "ObjectType"
        ? COLLECTION_CUSTOMER_LIMIT
        : COLLECTION_PLATFORM_LIMIT;
      const params: Record<string, RuntimeJsonValue> = {};
      if (Object.hasOwn(declaration.params, "page")) params.page = { number: 1, size: limit };
      if (Object.hasOwn(declaration.params, "size")) params.size = limit;
      if (Object.keys(params).length > 0) fixedParams = params;
    }
  }

  const useOptions = fixedParams || options?.ignoreImplicitParams?.length
    ? {
        ...(fixedParams ? { fixedParams } : {}),
        ...(options?.ignoreImplicitParams?.length ? { ignoreImplicitParams: options.ignoreImplicitParams } : {}),
      }
    : undefined;
  const raw = useMemberData(name, useOptions);
  const parsed = computed<ParsedCollectionRecords | null>(() =>
    raw.value.status === "ready" ? parseCollectionRecords(raw.value.value) : null,
  );
  const rows = computed<readonly PlatformObjectRecord[]>(() => parsed.value?.rows ?? []);
  const coverage = computed<CollectionCoverage>(() => parsed.value?.coverage ?? EMPTY_COVERAGE);
  const rowOperations = computed<PanelRowOperationsMap | undefined>(() =>
    raw.value.status === "ready" ? raw.value.rowOperations : undefined,
  );
  const state = computed<MemberDataState>(() => {
    const current = raw.value;
    if (current.status === "ready" && parsed.value && parsed.value.rows.length === 0 && !parsed.value.coverage.truncated) {
      return { status: "empty" };
    }
    return current;
  });

  return { state, rows, rowOperations, coverage };
}

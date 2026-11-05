const SKILL_ID = "quality-trace-graph";
const VERSION = "1.0.0";
const DEFAULT_TITLE = "Quality Traceability Graph";
const DEFAULT_MAX_NODES = 120;
const MIN_MAX_NODES = 10;
const HARD_MAX_NODES = 200;

const TYPE_LABELS = {
  batch: "Batch",
  "process-execution": "Process execution",
  "assembly-event": "Assembly event",
  "inspection-event": "Inspection event",
  "quality-decision": "Quality decision",
  "recall-decision": "Recall decision",
  product: "Product",
  material: "Material",
  part: "Part",
  component: "Component",
  supplier: "Supplier",
  customer: "Customer",
  shipment: "Shipment",
  order: "Order",
  "work-order": "Work order",
  equipment: "Equipment",
  complaint: "Complaint",
  other: "Other object",
};

const STATUS_LABELS = {
  normal: "Normal / unmarked",
  risk: "Risk",
  recalled: "Recalled",
  defective: "Defective",
  affected: "Affected",
  missing: "Data gap",
  isolated: "Isolated object",
};

const CATEGORY_DEFINITIONS = {
  anchor: { name: "Anchor", symbol: "roundRect" },
  risk: { name: "Quality risk", symbol: "roundRect" },
  gap: { name: "Data gap", symbol: "roundRect" },
  batch: { name: "Batch", symbol: "roundRect" },
  event: { name: "Process / event", symbol: "diamond" },
  product: { name: "Product", symbol: "roundRect" },
  material: { name: "Material / component", symbol: "rect" },
  party: { name: "Organization / party", symbol: "circle" },
  other: { name: "Other object", symbol: "roundRect" },
};

const THEME = {
  "background": {
    "$themeColor": "--el-bg-color"
  },
  "text": {
    "$themeColor": "--el-text-color-primary"
  },
  "muted": {
    "$themeColor": "--el-text-color-secondary"
  },
  "border": {
    "$themeColor": "--el-border-color"
  },
  "edge": {
    "$themeColor": "--el-color-info"
  },
  "derivedEdge": {
    "$themeColor": "--el-text-color-regular"
  },
  "gapEdge": {
    "$themeColor": "--el-color-warning"
  },
  "tooltipBackground": {
    "$themeColor": "--el-bg-color-overlay"
  },
  "tooltipText": {
    "$themeColor": "--el-text-color-primary"
  },
  "tooltipBorder": {
    "$themeColor": "--el-border-color"
  },
  "select": {
    "$themeColor": "--el-color-primary"
  },
  "category": {
    "anchor": {
      "fill": {
        "$themeColor": "--el-color-primary-light-9"
      },
      "border": {
        "$themeColor": "--el-color-primary"
      }
    },
    "risk": {
      "fill": {
        "$themeColor": "--el-color-danger-light-9"
      },
      "border": {
        "$themeColor": "--el-color-danger"
      }
    },
    "gap": {
      "fill": {
        "$themeColor": "--el-color-warning-light-9"
      },
      "border": {
        "$themeColor": "--el-color-warning"
      }
    },
    "batch": {
      "fill": {
        "$themeColor": "--el-color-success-light-9"
      },
      "border": {
        "$themeColor": "--el-color-success"
      }
    },
    "event": {
      "fill": {
        "$themeColor": "--el-color-info-light-9"
      },
      "border": {
        "$themeColor": "--el-color-info"
      }
    },
    "product": {
      "fill": {
        "$themeColor": "--el-color-primary-light-9"
      },
      "border": {
        "$themeColor": "--el-color-primary"
      }
    },
    "material": {
      "fill": {
        "$themeColor": "--el-color-success-light-9"
      },
      "border": {
        "$themeColor": "--el-color-success"
      }
    },
    "party": {
      "fill": {
        "$themeColor": "--el-color-primary-light-9"
      },
      "border": {
        "$themeColor": "--el-color-primary"
      }
    },
    "other": {
      "fill": {
        "$themeColor": "--el-color-info-light-9"
      },
      "border": {
        "$themeColor": "--el-color-info"
      }
    }
  }
};

function resolveThemeColors(value) {
  let root = document.documentElement;
  try { if (parent !== window && parent.document) root = parent.document.documentElement; } catch (error) {}
  const style = root.ownerDocument.defaultView.getComputedStyle(root);
  function resolve(item) {
    if (!item || typeof item !== "object") return item;
    if (item.$themeColor) return style.getPropertyValue(item.$themeColor).trim() || (item.$themeColor.includes("bg-color") || item.$themeColor.includes("light-9") ? "Canvas" : "CanvasText");
    if (Array.isArray(item)) return item.map(resolve);
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, resolve(child)]));
  }
  return resolve(value);
}

function observeThemeChanges(update) {
  let root = document.documentElement;
  try { if (parent !== window && parent.document) root = parent.document.documentElement; } catch (error) {}
  const observer = new MutationObserver(update);
  observer.observe(root, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", update);
  const timer = window.setInterval(update, 500);
  window.addEventListener("pagehide", () => {
    observer.disconnect(); scheme.removeEventListener("change", update); window.clearInterval(timer);
  }, { once: true });
}

function pick(object, keys) {
  if (!object || typeof object !== "object") return undefined;
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null && object[key] !== "") {
      return object[key];
    }
  }
  return undefined;
}

function toText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = toText(value).toLowerCase();
  return ["true", "1", "yes", "y", "是", "有"].includes(normalized);
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function businessKey(value) {
  const text = toText(value);
  if (!text) return "";
  const parts = text.split(":");
  return parts[parts.length - 1] || text;
}

function compactLabel(value, maxUnits = 16) {
  const text = toText(value);
  let units = 0;
  let result = "";
  for (const character of text) {
    const width = character.charCodeAt(0) > 255 ? 2 : 1;
    if (units + width > maxUnits) return `${result}...`;
    units += width;
    result += character;
  }
  return result;
}

function normalizeType(value, id = "") {
  const raw = toText(value).toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
  const aliases = new Map([
    ["batch", "batch"],
    ["lot", "batch"],
    ["批次", "batch"],
    ["物料批次", "batch"],
    ["原料批次", "batch"],
    ["中间批次", "batch"],
    ["成品批次", "batch"],
    ["process-execution", "process-execution"],
    ["production-execution", "process-execution"],
    ["工序执行", "process-execution"],
    ["工序执行事件", "process-execution"],
    ["生产执行", "process-execution"],
    ["assembly-event", "assembly-event"],
    ["assembly", "assembly-event"],
    ["装配事件", "assembly-event"],
    ["inspection-event", "inspection-event"],
    ["inspection", "inspection-event"],
    ["检验事件", "inspection-event"],
    ["检验", "inspection-event"],
    ["quality-decision", "quality-decision"],
    ["质量决策", "quality-decision"],
    ["质量处置", "quality-decision"],
    ["recall-decision", "recall-decision"],
    ["recall", "recall-decision"],
    ["召回决策", "recall-decision"],
    ["product", "product"],
    ["产品", "product"],
    ["产品实例", "product"],
    ["发动机", "product"],
    ["material", "material"],
    ["raw-material", "material"],
    ["原料", "material"],
    ["物料", "material"],
    ["part", "part"],
    ["零件", "part"],
    ["component", "component"],
    ["部件", "component"],
    ["supplier", "supplier"],
    ["供应商", "supplier"],
    ["customer", "customer"],
    ["客户", "customer"],
    ["shipment", "shipment"],
    ["运输", "shipment"],
    ["发运", "shipment"],
    ["order", "order"],
    ["订单", "order"],
    ["work-order", "work-order"],
    ["工单", "work-order"],
    ["equipment", "equipment"],
    ["设备", "equipment"],
    ["complaint", "complaint"],
    ["客诉", "complaint"],
  ]);
  if (aliases.has(raw)) return aliases.get(raw);

  const qualified = toText(id).toLowerCase().replaceAll("_", "-");
  for (const [alias, type] of aliases.entries()) {
    if (alias.length > 3 && qualified.includes(alias)) return type;
  }

  const key = businessKey(id).toUpperCase();
  if (/^(BAT|BX|LOT)-/.test(key)) return "batch";
  if (/^(PE|PROC)-/.test(key)) return "process-execution";
  if (/^ASM-/.test(key)) return "assembly-event";
  if (/^(INSP|IQC|IPQC|FQC)-/.test(key)) return "inspection-event";
  if (/^(RC|RECALL)-/.test(key)) return "recall-decision";
  if (/^(QD|QUALITY)-/.test(key)) return "quality-decision";
  if (/^SN-/.test(key)) return "product";
  if (/^(RM|MAT)-/.test(key)) return "material";
  if (/^(PRT|PART)-/.test(key)) return "part";
  if (/^(CMP|COMP)-/.test(key)) return "component";
  if (/^(SUP|VEN)-/.test(key)) return "supplier";
  if (/^(CUS|CUST)-/.test(key)) return "customer";
  if (/^(SHIP|DLV)-/.test(key)) return "shipment";
  if (/^(SO|PO|ORD)-/.test(key)) return "order";
  if (/^(WO|MO)-/.test(key)) return "work-order";
  if (/^(EQ|MC)-/.test(key)) return "equipment";
  return "other";
}

function normalizeStatus(value, broken = false) {
  if (broken) return "missing";
  const raw = toText(value).toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
  const aliases = new Map([
    ["normal", "normal"],
    ["ok", "normal"],
    ["正常", "normal"],
    ["risk", "risk"],
    ["warning", "risk"],
    ["风险", "risk"],
    ["recalled", "recalled"],
    ["recall", "recalled"],
    ["已召回", "recalled"],
    ["召回", "recalled"],
    ["defective", "defective"],
    ["defect", "defective"],
    ["缺陷", "defective"],
    ["不合格", "defective"],
    ["affected", "affected"],
    ["impacted", "affected"],
    ["受影响", "affected"],
    ["missing", "missing"],
    ["broken", "missing"],
    ["incomplete", "missing"],
    ["数据缺口", "missing"],
    ["无后续记录", "missing"],
    ["isolated", "isolated"],
    ["孤立", "isolated"],
  ]);
  return aliases.get(raw) || "normal";
}

function normalizePathType(value) {
  const raw = toText(value).toLowerCase().replaceAll("_", "-");
  if (["derived", "indirect", "推导", "派生", "间接"].includes(raw)) return "derived";
  if (["missing", "gap", "broken", "断点", "缺口"].includes(raw)) return "missing";
  return "direct";
}

function statusPriority(status) {
  return {
    normal: 0,
    isolated: 1,
    affected: 2,
    risk: 3,
    recalled: 4,
    defective: 5,
    missing: 6,
  }[status] ?? 0;
}

function categoryKey(node) {
  if (node.isAnchor) return "anchor";
  if (["risk", "recalled", "defective", "affected"].includes(node.status)) return "risk";
  if (["missing", "isolated"].includes(node.status)) return "gap";
  if (node.type === "batch") return "batch";
  if (["process-execution", "assembly-event", "inspection-event", "quality-decision", "recall-decision", "shipment", "complaint"].includes(node.type)) return "event";
  if (node.type === "product") return "product";
  if (["material", "part", "component"].includes(node.type)) return "material";
  if (["supplier", "customer"].includes(node.type)) return "party";
  return "other";
}

function symbolSize(node, category) {
  if (category === "event") return [88, 58];
  if (category === "product") return [108, 44];
  if (category === "party") return [74, 74];
  if (category === "material") return [96, 42];
  if (node.type === "batch") return [96, 42];
  return [100, 42];
}

function addWarning(warnings, code, message, count = 1) {
  const existing = warnings.find((warning) => warning.code === code);
  if (existing) {
    existing.count += count;
    return;
  }
  warnings.push({ code, message, count });
}

function normalizeNode(raw, index) {
  const object = raw && typeof raw === "object" ? raw : { id: raw };
  const id = toText(pick(object, ["id", "object_id", "objectId", "code", "key", "对象ID", "对象id"]));
  if (!id) return null;
  const broken = toBoolean(pick(object, ["broken", "incomplete", "dataGap", "data_gap", "无后续记录"]));
  const rawType = pick(object, ["type", "object_type", "objectType", "node_type", "nodeType", "kind", "对象类型", "本体类型"]);
  const rawStatus = pick(object, ["status", "state", "quality_status", "qualityStatus", "状态", "质量状态"]);
  const fullName = toText(pick(object, ["name", "label", "display_name", "displayName", "business_key", "businessKey", "名称"])) || businessKey(id) || id;
  return {
    id,
    fullName,
    displayName: compactLabel(fullName),
    type: normalizeType(rawType, `${id} ${fullName}`),
    status: normalizeStatus(rawStatus, broken),
    isAnchor: toBoolean(pick(object, ["isAnchor", "is_anchor", "anchor", "riskAnchor", "risk_anchor", "锚点"])),
    broken,
    description: toText(pick(object, ["description", "detail", "note", "remark", "说明", "备注"])),
    inferred: toBoolean(object.inferred),
    inputIndex: index,
  };
}

function mergeNodes(existing, incoming) {
  const existingTypeIsWeak = existing.type === "other";
  const incomingNameIsBetter = existing.fullName === businessKey(existing.id) && incoming.fullName !== businessKey(incoming.id);
  return {
    ...existing,
    fullName: incomingNameIsBetter ? incoming.fullName : existing.fullName,
    displayName: incomingNameIsBetter ? incoming.displayName : existing.displayName,
    type: existingTypeIsWeak && incoming.type !== "other" ? incoming.type : existing.type,
    status: statusPriority(incoming.status) > statusPriority(existing.status) ? incoming.status : existing.status,
    isAnchor: existing.isAnchor || incoming.isAnchor,
    broken: existing.broken || incoming.broken,
    description: existing.description || incoming.description,
    inferred: existing.inferred && incoming.inferred,
  };
}

function normalizeLink(raw, index) {
  const object = raw && typeof raw === "object" ? raw : {};
  const source = toText(pick(object, ["source", "from", "src", "source_id", "sourceId", "起点", "源对象"]));
  const target = toText(pick(object, ["target", "to", "dst", "target_id", "targetId", "终点", "目标对象"]));
  if (!source || !target) return null;
  const relation = toText(pick(object, ["relation", "relation_name", "relationName", "edge_name", "edgeName", "predicate", "关系", "关系名称"])) || "related to";
  return {
    source,
    target,
    relation,
    pathType: normalizePathType(pick(object, ["pathType", "path_type", "impactLevel", "impact_level", "路径类型"])),
    evidence: toText(pick(object, ["evidence", "description", "detail", "说明", "证据"])),
    inputIndex: index,
  };
}

function extractRawGraph(input) {
  const data = input?.data ?? input;
  let nodes = [];
  let links = [];

  if (Array.isArray(data)) {
    const edgeLike = data.some((row) => row && typeof row === "object" && pick(row, ["source", "from", "src", "source_id", "sourceId"]));
    if (edgeLike) links = data;
    else nodes = data;
  } else if (data && typeof data === "object") {
    nodes = pick(data, ["nodes", "vertices", "objects", "entities"]) || [];
    links = pick(data, ["links", "edges", "relations"]) || [];
    if (!Array.isArray(links) || links.length === 0) {
      const rows = pick(data, ["rows", "data"]);
      if (Array.isArray(rows) && rows.some((row) => pick(row, ["source", "from", "src", "source_id", "sourceId"]))) links = rows;
    }
  }

  if (Array.isArray(input?.nodes) && nodes.length === 0) nodes = input.nodes;
  if (Array.isArray(input?.links) && links.length === 0) links = input.links;
  if (Array.isArray(input?.edges) && links.length === 0) links = input.edges;

  return {
    nodes: Array.isArray(nodes) ? nodes : [],
    links: Array.isArray(links) ? links : [],
  };
}

function buildAliasMap(nodes) {
  const candidates = new Map();
  for (const node of nodes) {
    for (const alias of [node.id, businessKey(node.id)]) {
      if (!alias) continue;
      if (!candidates.has(alias)) candidates.set(alias, new Set());
      candidates.get(alias).add(node.id);
    }
  }
  const aliases = new Map();
  for (const [alias, ids] of candidates.entries()) {
    if (ids.size === 1) aliases.set(alias, [...ids][0]);
  }
  return aliases;
}

function normalizeGraph(input) {
  const warnings = [];
  const raw = extractRawGraph(input);
  const nodeMap = new Map();
  let invalidNodeCount = 0;
  let duplicateNodeCount = 0;

  raw.nodes.forEach((candidate, index) => {
    const node = normalizeNode(candidate, index);
    if (!node) {
      invalidNodeCount += 1;
      return;
    }
    if (nodeMap.has(node.id)) {
      duplicateNodeCount += 1;
      nodeMap.set(node.id, mergeNodes(nodeMap.get(node.id), node));
    } else {
      nodeMap.set(node.id, node);
    }
  });

  if (invalidNodeCount) addWarning(warnings, "INVALID_NODES_SKIPPED", "Nodes without an ID were skipped.", invalidNodeCount);
  if (duplicateNodeCount) addWarning(warnings, "DUPLICATE_NODES_MERGED", "Duplicate nodes were merged by ID.", duplicateNodeCount);

  let aliases = buildAliasMap([...nodeMap.values()]);
  const normalizedLinks = [];
  let invalidLinkCount = 0;
  let missingRelationCount = 0;
  let inferredEndpointCount = 0;

  raw.links.forEach((candidate, index) => {
    const link = normalizeLink(candidate, index);
    if (!link) {
      invalidLinkCount += 1;
      return;
    }
    const candidateObject = candidate && typeof candidate === "object" ? candidate : {};
    if (!pick(candidateObject, ["relation", "relation_name", "relationName", "edge_name", "edgeName", "predicate", "关系", "关系名称"])) missingRelationCount += 1;

    link.source = nodeMap.has(link.source) ? link.source : aliases.get(link.source) || link.source;
    link.target = nodeMap.has(link.target) ? link.target : aliases.get(link.target) || link.target;

    for (const endpoint of [link.source, link.target]) {
      if (nodeMap.has(endpoint)) continue;
      const inferred = normalizeNode({ id: endpoint, inferred: true }, nodeMap.size);
      nodeMap.set(endpoint, inferred);
      inferredEndpointCount += 1;
    }
    normalizedLinks.push(link);
    aliases = buildAliasMap([...nodeMap.values()]);
  });

  if (invalidLinkCount) addWarning(warnings, "INVALID_LINKS_SKIPPED", "Links without a source or target were skipped.", invalidLinkCount);
  if (missingRelationCount) addWarning(warnings, "MISSING_RELATION_NAMES", "Links without a relation name are displayed as related to.", missingRelationCount);
  if (inferredEndpointCount) addWarning(warnings, "ENDPOINT_NODES_INFERRED", "Undeclared endpoint nodes were created from link endpoint IDs.", inferredEndpointCount);

  const linkMap = new Map();
  let duplicateLinkCount = 0;
  for (const link of normalizedLinks) {
    const key = `${link.source}\u0000${link.target}\u0000${link.relation}\u0000${link.pathType}`;
    if (linkMap.has(key)) {
      duplicateLinkCount += 1;
      continue;
    }
    linkMap.set(key, link);
  }
  if (duplicateLinkCount) addWarning(warnings, "DUPLICATE_LINKS_REMOVED", "Duplicate links were removed.", duplicateLinkCount);

  const nodes = [...nodeMap.values()];
  const links = [...linkMap.values()];
  aliases = buildAliasMap(nodes);

  const requestedAnchorValues = [];
  if (input?.anchorId !== undefined) requestedAnchorValues.push(input.anchorId);
  if (Array.isArray(input?.anchorIds)) requestedAnchorValues.push(...input.anchorIds);
  if (input?.anchors && typeof input.anchors === "object") requestedAnchorValues.push(...Object.values(input.anchors));

  for (const value of requestedAnchorValues.flat(Infinity)) {
    const requested = toText(value);
    if (!requested) continue;
    const resolved = nodeMap.has(requested) ? requested : aliases.get(requested);
    if (resolved && nodeMap.has(resolved)) nodeMap.get(resolved).isAnchor = true;
    else addWarning(warnings, "ANCHOR_NOT_FOUND", `Anchor ${requested} was not found in the input nodes.`);
  }

  const degree = new Map(nodes.map((node) => [node.id, 0]));
  for (const link of links) {
    degree.set(link.source, (degree.get(link.source) || 0) + 1);
    degree.set(link.target, (degree.get(link.target) || 0) + 1);
  }
  let isolatedCount = 0;
  for (const node of nodes) {
    if ((degree.get(node.id) || 0) !== 0) continue;
    isolatedCount += 1;
    if (node.status === "normal") node.status = "isolated";
  }
  if (isolatedCount) addWarning(warnings, "ISOLATED_NODES", "The input contains isolated nodes without any links.", isolatedCount);

  const anchorIds = nodes.filter((node) => node.isAnchor).map((node) => node.id);
  if (nodes.length > 0 && anchorIds.length === 0) addWarning(warnings, "NO_ANCHOR", "No anchor was specified; the graph will render without prioritizing an investigation target.", 1);

  return {
    nodes,
    links,
    anchorIds,
    warnings,
    originalNodeCount: raw.nodes.length,
    originalLinkCount: raw.links.length,
  };
}

function topologicalOrder(nodes, links) {
  const ids = nodes.map((node) => node.id);
  const indegree = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, []]));
  for (const link of links) {
    if (!indegree.has(link.source) || !indegree.has(link.target)) continue;
    indegree.set(link.target, indegree.get(link.target) + 1);
    outgoing.get(link.source).push(link.target);
  }
  for (const targets of outgoing.values()) targets.sort((a, b) => a.localeCompare(b));
  const queue = ids.filter((id) => indegree.get(id) === 0).sort((a, b) => a.localeCompare(b));
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const target of outgoing.get(id)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) {
        queue.push(target);
        queue.sort((a, b) => a.localeCompare(b));
      }
    }
  }
  return { order, hasCycle: order.length !== ids.length, outgoing };
}

function truncateGraph(graph, maxNodes) {
  if (graph.nodes.length <= maxNodes) return { ...graph, omittedNodeCount: 0, omittedLinkCount: 0 };
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const adjacency = new Map([...nodeIds].map((id) => [id, new Set()]));
  const indegree = new Map([...nodeIds].map((id) => [id, 0]));
  for (const link of graph.links) {
    if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) continue;
    adjacency.get(link.source).add(link.target);
    adjacency.get(link.target).add(link.source);
    indegree.set(link.target, indegree.get(link.target) + 1);
  }

  let seeds = graph.anchorIds.filter((id) => nodeIds.has(id));
  if (seeds.length === 0) seeds = [...nodeIds].filter((id) => indegree.get(id) === 0).sort((a, b) => a.localeCompare(b));
  if (seeds.length === 0) seeds = [...nodeIds].sort((a, b) => a.localeCompare(b)).slice(0, 1);

  const kept = new Set();
  const queued = new Set();
  const queue = [];
  for (const seed of seeds) {
    if (queued.has(seed)) continue;
    queued.add(seed);
    queue.push(seed);
  }

  while (queue.length && kept.size < maxNodes) {
    const id = queue.shift();
    kept.add(id);
    const neighbors = [...(adjacency.get(id) || [])].sort((a, b) => a.localeCompare(b));
    for (const neighbor of neighbors) {
      if (queued.has(neighbor)) continue;
      queued.add(neighbor);
      queue.push(neighbor);
    }
  }

  if (kept.size < maxNodes) {
    for (const id of [...nodeIds].sort((a, b) => a.localeCompare(b))) {
      if (kept.size >= maxNodes) break;
      kept.add(id);
    }
  }

  const nodes = graph.nodes.filter((node) => kept.has(node.id));
  const links = graph.links.filter((link) => kept.has(link.source) && kept.has(link.target));
  const omittedNodeCount = graph.nodes.length - nodes.length;
  const omittedLinkCount = graph.links.length - links.length;
  addWarning(graph.warnings, "GRAPH_TRUNCATED", `Node count exceeds maxNodes=${maxNodes}; nodes near anchors were prioritized.`, omittedNodeCount);

  return {
    ...graph,
    nodes,
    links,
    anchorIds: graph.anchorIds.filter((id) => kept.has(id)),
    omittedNodeCount,
    omittedLinkCount,
  };
}

function computeDepths(nodes, links, anchorIds, hasCycle) {
  const ids = nodes.map((node) => node.id);
  const idSet = new Set(ids);
  const outgoing = new Map(ids.map((id) => [id, []]));
  const incoming = new Map(ids.map((id) => [id, []]));
  for (const link of links) {
    if (!idSet.has(link.source) || !idSet.has(link.target)) continue;
    outgoing.get(link.source).push(link.target);
    incoming.get(link.target).push(link.source);
  }
  for (const values of [...outgoing.values(), ...incoming.values()]) values.sort((a, b) => a.localeCompare(b));

  const depths = new Map();
  const anchors = anchorIds.filter((id) => idSet.has(id));
  if (anchors.length > 0) {
    for (const anchor of anchors) depths.set(anchor, 0);
    if (hasCycle) {
      const queue = [...anchors];
      while (queue.length) {
        const source = queue.shift();
        for (const target of outgoing.get(source)) {
          if (depths.has(target)) continue;
          depths.set(target, depths.get(source) + 1);
          queue.push(target);
        }
      }
    } else {
      const { order } = topologicalOrder(nodes, links);
      for (const source of order) {
        if (!depths.has(source)) continue;
        for (const target of outgoing.get(source)) {
          depths.set(target, Math.max(depths.get(target) ?? Number.NEGATIVE_INFINITY, depths.get(source) + 1));
        }
      }
    }

    const reverseQueue = [...anchors];
    const reverseDistance = new Map(anchors.map((id) => [id, 0]));
    while (reverseQueue.length) {
      const target = reverseQueue.shift();
      for (const source of incoming.get(target)) {
        if (reverseDistance.has(source)) continue;
        reverseDistance.set(source, reverseDistance.get(target) + 1);
        reverseQueue.push(source);
        if (!depths.has(source)) depths.set(source, -reverseDistance.get(source));
      }
    }
  } else if (!hasCycle) {
    const { order } = topologicalOrder(nodes, links);
    for (const id of order) {
      if (!depths.has(id)) depths.set(id, 0);
      for (const target of outgoing.get(id)) depths.set(target, Math.max(depths.get(target) ?? 0, depths.get(id) + 1));
    }
  }

  let nextDepth = depths.size ? Math.max(...depths.values()) + 1 : 0;
  for (const id of ids.sort((a, b) => a.localeCompare(b))) {
    if (depths.has(id)) continue;
    depths.set(id, nextDepth);
  }
  return { depths, incoming };
}

function computePositions(nodes, links, anchorIds, direction, hasCycle) {
  const { depths, incoming } = computeDepths(nodes, links, anchorIds, hasCycle);
  const layers = new Map();
  for (const node of nodes) {
    const depth = depths.get(node.id) ?? 0;
    if (!layers.has(depth)) layers.set(depth, []);
    layers.get(depth).push(node);
  }

  const layerKeys = [...layers.keys()].sort((a, b) => a - b);
  const orderIndex = new Map();
  for (const key of layerKeys) {
    const layer = layers.get(key);
    layer.sort((a, b) => {
      const aParents = (incoming.get(a.id) || []).map((id) => orderIndex.get(id)).filter(Number.isFinite);
      const bParents = (incoming.get(b.id) || []).map((id) => orderIndex.get(id)).filter(Number.isFinite);
      const aMean = aParents.length ? aParents.reduce((sum, value) => sum + value, 0) / aParents.length : Number.POSITIVE_INFINITY;
      const bMean = bParents.length ? bParents.reduce((sum, value) => sum + value, 0) / bParents.length : Number.POSITIVE_INFINITY;
      if (aMean !== bMean) return aMean - bMean;
      if (a.isAnchor !== b.isAnchor) return a.isAnchor ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
    layer.forEach((node, index) => orderIndex.set(node.id, index));
  }

  const positions = new Map();
  layerKeys.forEach((key, layerIndex) => {
    const layer = layers.get(key);
    layer.forEach((node, itemIndex) => {
      const crossAxis = (itemIndex - (layer.length - 1) / 2) * 120;
      const mainAxis = layerIndex * 230;
      positions.set(node.id, direction === "TB" ? { x: crossAxis, y: mainAxis } : { x: mainAxis, y: crossAxis });
    });
  });
  return { positions, layerCount: layerKeys.length, maxLayerSize: Math.max(1, ...[...layers.values()].map((layer) => layer.length)) };
}

function buildOption(graph, title, direction, theme, showRelationLabels = true) {
  const { hasCycle } = topologicalOrder(graph.nodes, graph.links);
  const { positions, layerCount, maxLayerSize } = computePositions(graph.nodes, graph.links, graph.anchorIds, direction, hasCycle);
  const categoryKeys = [];
  for (const node of graph.nodes) {
    const key = categoryKey(node);
    if (!categoryKeys.includes(key)) categoryKeys.push(key);
  }
  const preferredOrder = ["anchor", "risk", "gap", "batch", "event", "product", "material", "party", "other"];
  categoryKeys.sort((a, b) => preferredOrder.indexOf(a) - preferredOrder.indexOf(b));
  const categories = categoryKeys.map((key) => ({
    name: CATEGORY_DEFINITIONS[key].name,
    symbol: CATEGORY_DEFINITIONS[key].symbol,
    itemStyle: {
      color: theme.category[key].fill,
      borderColor: theme.category[key].border,
      borderWidth: 2,
    },
  }));
  const categoryIndex = new Map(categoryKeys.map((key, index) => [key, index]));

  const data = graph.nodes.map((node) => {
    const category = categoryKey(node);
    const style = theme.category[category];
    const size = symbolSize(node, category);
    const position = positions.get(node.id) || { x: 0, y: 0 };
    return {
      id: node.id,
      name: node.displayName,
      fullName: node.fullName,
      rawId: node.id,
      type: node.type,
      typeLabel: TYPE_LABELS[node.type] || TYPE_LABELS.other,
      status: node.status,
      statusLabel: STATUS_LABELS[node.status] || STATUS_LABELS.normal,
      description: node.description,
      isAnchor: node.isAnchor,
      inferred: node.inferred,
      broken: node.broken,
      x: position.x,
      y: position.y,
      value: [position.x, position.y],
      category: categoryIndex.get(category),
      symbol: CATEGORY_DEFINITIONS[category].symbol,
      symbolSize: size,
      itemStyle: {
        color: style.fill,
        borderColor: style.border,
        borderWidth: node.isAnchor ? 3 : 2,
        borderType: node.status === "missing" || node.status === "isolated" ? "dashed" : "solid",
      },
      label: {
        show: true,
        color: theme.text,
        fontSize: 11,
        fontWeight: node.isAnchor || statusPriority(node.status) >= 3 ? 500 : 400,
        width: Math.max(54, size[0] - 12),
        overflow: "truncate",
      },
      select: {
        itemStyle: { borderColor: theme.select, borderWidth: 4 },
        label: { color: theme.text, fontWeight: 500 },
      },
    };
  });

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const links = graph.links.map((link) => {
    const sourceNode = nodeById.get(link.source);
    const targetNode = nodeById.get(link.target);
    const touchesGap = sourceNode?.status === "missing" || targetNode?.status === "missing";
    const lineType = link.pathType === "derived" ? "dashed" : link.pathType === "missing" || touchesGap ? "dotted" : "solid";
    const color = link.pathType === "missing" || touchesGap ? theme.gapEdge : link.pathType === "derived" ? theme.derivedEdge : theme.edge;
    return {
      source: link.source,
      target: link.target,
      name: link.relation,
      relation: link.relation,
      value: link.relation,
      pathType: link.pathType,
      evidence: link.evidence,
      sourceName: sourceNode?.fullName || businessKey(link.source),
      targetName: targetNode?.fullName || businessKey(link.target),
      lineStyle: {
        color,
        width: link.pathType === "direct" ? 1.8 : 1.5,
        type: lineType,
        opacity: 0.82,
        curveness: hasCycle ? 0.08 : 0.03,
      },
    };
  });

  const top = categoryKeys.length > 0 ? 86 : 56;
  const xValues = data.map((node) => node.value[0]);
  const yValues = data.map((node) => node.value[1]);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const xPadding = Math.max(115, (xMax - xMin) * 0.035);
  const yPadding = Math.max(90, (yMax - yMin) * 0.18);
  return {
    backgroundColor: theme.background,
    animation: false,
    color: categoryKeys.map((key) => theme.category[key].border),
    title: {
      text: title,
      subtext: `${graph.nodes.length} objects · ${graph.links.length} relations`,
      left: "center",
      top: 12,
      textStyle: { color: theme.text, fontSize: 16, fontWeight: 500 },
      subtextStyle: { color: theme.muted, fontSize: 11, fontWeight: 400 },
    },
    legend: {
      show: categoryKeys.length > 0,
      type: "scroll",
      top: 53,
      left: 24,
      right: 24,
      itemWidth: 14,
      itemHeight: 10,
      itemGap: 16,
      selectedMode: false,
      textStyle: { color: theme.muted, fontSize: 11 },
      pageTextStyle: { color: theme.muted },
      data: categories.map((category) => category.name),
    },
    tooltip: {
      trigger: "item",
      confine: true,
      enterable: false,
      backgroundColor: theme.tooltipBackground,
      borderColor: theme.tooltipBorder,
      borderWidth: 1,
      padding: [9, 11],
      textStyle: { color: theme.tooltipText, fontSize: 12 },
      extraCssText: "max-width:320px;white-space:normal;line-height:1.55;",
    },
    aria: {
      enabled: true,
      decal: { show: false },
      description: `${title}, containing ${graph.nodes.length} objects and ${graph.links.length} directed relations.`,
    },
    grid: {
      left: 48,
      right: 48,
      top,
      bottom: 36,
      containLabel: false,
    },
    xAxis: {
      type: "value",
      min: xMin - xPadding,
      max: xMax + xPadding,
      show: false,
      scale: true,
    },
    yAxis: {
      type: "value",
      min: yMin - yPadding,
      max: yMax + yPadding,
      show: false,
      scale: true,
      inverse: true,
    },
    series: [
      {
        id: "quality-trace-series",
        type: "graph",
        layout: "none",
        coordinateSystem: "cartesian2d",
        traceDirection: direction,
        layerCount,
        maxLayerSize,
        data,
        links,
        categories,
        roam: false,
        draggable: false,
        selectedMode: "single",
        edgeSymbol: ["none", "arrow"],
        edgeSymbolSize: [0, 8],
        cursor: "pointer",
        emphasis: {
          focus: "adjacency",
          scale: 1.08,
          lineStyle: { width: 3, opacity: 1 },
        },
        blur: {
          itemStyle: { opacity: 0.2 },
          lineStyle: { opacity: 0.08 },
          label: { opacity: 0.25 },
        },
        edgeLabel: {
          show: Boolean(showRelationLabels),
          color: theme.muted,
          fontSize: 10,
          backgroundColor: theme.background,
          padding: [2, 3],
          borderRadius: 2,
          width: 86,
          overflow: "truncate",
        },
        labelLayout: { hideOverlap: false },
        lineStyle: { color: theme.edge, width: 1.6, opacity: 0.82 },
      },
    ],
  };
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}

function escapeHtml(value) {
  return toText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function errorHtml(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Quality Traceability Graph</title>
  <style>
    * { box-sizing: border-box; }
    :root { color-scheme: light dark; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Inter, "Segoe UI", "Microsoft YaHei", sans-serif; background: Canvas; color: CanvasText; }
    .message { max-width: 560px; padding: 24px; text-align: center; border: 1px solid ButtonBorder; border-radius: 6px; }
    .message strong { display: block; margin-bottom: 8px; font-weight: 500; }
  </style>
</head>
<body><div class="message" role="alert"><strong>Unable to generate the quality traceability graph</strong>${escapeHtml(message)}</div></body>
</html>`;
}

function generateHtml(option, title) {
  const optionJson = safeJson(option);
  const ariaTitle = escapeHtml(title);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${ariaTitle}</title>
  <script src="/api/skills/resources/executable/visualization/${SKILL_ID}/scripts/echarts.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
    #chart { width: 100%; height: 100%; min-height: 320px; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  </style>
</head>
<body>
  <div id="chart" role="img" aria-label="${ariaTitle}"></div>
  <div id="selection-summary" class="sr-only" aria-live="polite"></div>
  <script>
    ${resolveThemeColors.toString()}
    ${observeThemeChanges.toString()}
    const baseOption = ${optionJson};
    const chartElement = document.getElementById("chart");
    const selectionSummary = document.getElementById("selection-summary");
    const chart = echarts.init(chartElement, null, { renderer: "canvas", useDirtyRect: true });
    let renderedTheme = null;
    let renderedCompact = null;

    function escapeTooltip(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function hydrateOption(option, compact) {
      const series = option.series[0];
      if (compact) {
        option.title.left = 12;
        option.title.right = 12;
        option.title.textStyle.fontSize = 14;
        option.legend.left = 12;
        option.legend.right = 12;
        option.grid.left = 18;
        option.grid.right = 18;
        if (series.traceDirection === "LR") {
          series.traceDirection = "TB";
          series.data.forEach((node) => {
            if (!Array.isArray(node.value) || node.value.length < 2) return;
            node.value = [node.value[1], node.value[0]];
            node.x = node.value[0];
            node.y = node.value[1];
          });
          const xValues = series.data.map((node) => node.value?.[0]).filter(Number.isFinite);
          const yValues = series.data.map((node) => node.value?.[1]).filter(Number.isFinite);
          const xMin = Math.min(...xValues);
          const xMax = Math.max(...xValues);
          const yMin = Math.min(...yValues);
          const yMax = Math.max(...yValues);
          option.xAxis.min = xMin - Math.max(82, (xMax - xMin) * 0.22);
          option.xAxis.max = xMax + Math.max(82, (xMax - xMin) * 0.22);
          option.yAxis.min = yMin - Math.max(105, (yMax - yMin) * 0.035);
          option.yAxis.max = yMax + Math.max(105, (yMax - yMin) * 0.035);
        }
        series.data.forEach((node) => {
          if (node.label) node.label.fontSize = 10;
        });
        series.edgeLabel.width = 64;
        series.edgeLabel.fontSize = 9;
        series.edgeLabel.show = false;
      }
      option.tooltip.formatter = (params) => {
        const data = params.data || {};
        if (params.dataType === "edge") {
          const pathLabel = data.pathType === "derived" ? "Derived relation" : data.pathType === "missing" ? "Data gap" : "Direct relation";
          const evidence = data.evidence ? "<br/>Evidence: " + escapeTooltip(data.evidence) : "";
          return escapeTooltip(data.sourceName) + "<br/><strong>" + escapeTooltip(data.relation || "related to") + "</strong><br/>" + escapeTooltip(data.targetName) + "<br/>Path: " + pathLabel + evidence;
        }
        const anchor = data.isAnchor ? "<br/>Flag: Investigation anchor" : "";
        const inferred = data.inferred ? "<br/>Flag: Inferred from a link endpoint" : "";
        const description = data.description ? "<br/>Description: " + escapeTooltip(data.description) : "";
        return "<strong>" + escapeTooltip(data.fullName || data.name) + "</strong><br/>Type: " + escapeTooltip(data.typeLabel) + "<br/>Status: " + escapeTooltip(data.statusLabel) + anchor + inferred + description;
      };
      series.edgeLabel.formatter = (params) => params.data?.relation || "related to";
      return option;
    }

    function render(force = false) {
      const themedOption = resolveThemeColors(baseOption);
      const signature = JSON.stringify(themedOption);
      const compact = window.innerWidth < 560;
      if (!force && signature === renderedTheme && compact === renderedCompact) {
        chart.resize();
        return;
      }
      renderedTheme = signature;
      renderedCompact = compact;
      const option = hydrateOption(themedOption, compact);
      chart.setOption(option, true);
      chart.resize();
    }

    chart.on("click", (params) => {
      if (params.dataType !== "node") return;
      const data = params.data || {};
      selectionSummary.textContent = "Selected " + (data.fullName || data.name) + "; type " + (data.typeLabel || "Unknown") + "; status " + (data.statusLabel || "Unknown");
    });

    observeThemeChanges(() => render(false));

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => render(false), 80);
    });
    if (window.ResizeObserver) new ResizeObserver(() => chart.resize()).observe(chartElement);
    render(true);
  </script>
</body>
</html>`;
}

export async function execute(input = {}) {
  try {
    const title = toText(input.title) || DEFAULT_TITLE;
    const direction = toText(input.direction).toUpperCase() === "TB" ? "TB" : "LR";
    const layout = toText(input.layout).toLowerCase() || "layered";
    const maxNodes = clampInteger(input.maxNodes, DEFAULT_MAX_NODES, MIN_MAX_NODES, HARD_MAX_NODES);
    const showRelationLabels = input.showRelationLabels !== false;
    const normalized = normalizeGraph(input);

    if (layout !== "layered") addWarning(normalized.warnings, "LAYOUT_FALLBACK", `Unsupported layout=${layout}; using layered.`, 1);
    if (normalized.nodes.length === 0) {
      return {
        html: errorHtml("No renderable nodes were found. Provide {nodes, links} or an array of source/target links."),
        meta: { skillId: SKILL_ID, version: VERSION, error: true, code: "EMPTY_GRAPH", warningCount: normalized.warnings.length, warnings: normalized.warnings },
      };
    }
    if (normalized.links.length === 0) addWarning(normalized.warnings, "NO_LINKS", "No valid links were provided; only isolated nodes can be displayed.", 1);

    const fullCycle = topologicalOrder(normalized.nodes, normalized.links).hasCycle;
    if (fullCycle) addWarning(normalized.warnings, "CYCLE_DETECTED", "The input contains a directed cycle; it has been preserved. Check the relation directions.", 1);

    const graph = truncateGraph(normalized, maxNodes);
    const renderedCycle = topologicalOrder(graph.nodes, graph.links).hasCycle;
    const option = buildOption(graph, title, direction, THEME, showRelationLabels);
    const html = generateHtml(option, title);

    const objectTypes = new Set(graph.nodes.map((node) => node.type));
    const relationTypes = new Set(graph.links.map((link) => link.relation));
    return {
      html,
      meta: {
        skillId: SKILL_ID,
        version: VERSION,
        title,
        layout: "layered",
        direction,
        nodeCount: graph.nodes.length,
        linkCount: graph.links.length,
        originalNodeCount: normalized.originalNodeCount,
        originalLinkCount: normalized.originalLinkCount,
        inferredNodeCount: graph.nodes.filter((node) => node.inferred).length,
        omittedNodeCount: graph.omittedNodeCount || 0,
        omittedLinkCount: graph.omittedLinkCount || 0,
        objectTypeCount: objectTypes.size,
        relationTypeCount: relationTypes.size,
        anchorIds: graph.anchorIds,
        hasCycle: fullCycle || renderedCycle,
        warningCount: graph.warnings.length,
        warnings: graph.warnings,
      },
    };
  } catch (error) {
    return {
      html: errorHtml(error?.message || "Unknown error"),
      meta: {
        skillId: SKILL_ID,
        version: VERSION,
        error: true,
        code: "RENDER_FAILED",
        message: error?.message || String(error),
      },
    };
  }
}

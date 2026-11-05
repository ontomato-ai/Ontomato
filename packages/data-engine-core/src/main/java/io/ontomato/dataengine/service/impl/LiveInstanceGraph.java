package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.Semaphore;
import java.util.function.Supplier;

import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.dataAdapter.DslExecutionMode;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.util.DslUtil;

/**
 * Bounded, read-only exploration of the current datasource, expressed as graph-pattern DSL queries
 * run through the domain's {@link DataAdapter}. Every operation is on demand and bounded, so the
 * feature works across every installed adapter instead of a single database.
 */
@Service
public class LiveInstanceGraph {
    private final AdminService admin;
    private final BusinessConfigService configs;
    private final DataAdapterRegistry adapters;
    private final Semaphore permits = new Semaphore(4);
    private static final int PAGE_SIZE = 100;
    private static final int MAX_OVERVIEW_EDGES = 2000;
    private static final int PARALLEL_THRESHOLD = 6;
    private static final long SCHEMA_TTL_MS = 5_000;
    private static final long STATISTICS_TTL_MS = 60_000;
    private static final long OVERVIEW_TTL_MS = 30_000;
    private static final ExecutorService QUERY_POOL = Executors.newFixedThreadPool(4, runnable -> {
        Thread thread = new Thread(runnable, "instance-graph-query");
        thread.setDaemon(true);
        return thread;
    });
    private record CachedStatistics(long expiresAt, JSONObject data) {}
    private record CachedOverview(long expiresAt, JSONObject data) {}
    private record SchemaSnapshot(String version, Map<String, Object> schema,
            Map<String, ObjectType> types, List<Relation> relations, long expiresAt) {}
    private final Map<String, CachedStatistics> statisticsCache = new ConcurrentHashMap<>();
    private final Map<String, CachedOverview> overviewCache = new ConcurrentHashMap<>();
    private final Map<String, SchemaSnapshot> schemaSnapshots = new ConcurrentHashMap<>();
    private final Map<String, CompletableFuture<JSONObject>> overviewBuilds = new ConcurrentHashMap<>();

    /**
     * Bounded lease pool: each parallel task borrows one adapter instance, so per-adapter caches stay
     * useful while no adapter is ever used by two threads at once.
     */
    private final class AdapterPool {
        private final Supplier<DataAdapter> factory;
        private final BlockingQueue<DataAdapter> idle = new LinkedBlockingQueue<>();
        private int created;

        AdapterPool(Supplier<DataAdapter> factory) {
            this.factory = factory;
        }

        DataAdapter acquire() throws InterruptedException {
            DataAdapter adapter = idle.poll();
            if (adapter != null) return adapter;
            synchronized (this) {
                if (created < PARALLEL_THRESHOLD) {
                    created++;
                    try {
                        return factory.get();
                    } catch (RuntimeException error) {
                        created--;
                        throw error;
                    }
                }
            }
            return idle.take();
        }

        void release(DataAdapter adapter) {
            idle.offer(adapter);
        }
    }

    @FunctionalInterface
    private interface AdapterTask<T> {
        T run(DataAdapter adapter) throws Exception;
    }

    public LiveInstanceGraph(AdminService admin, BusinessConfigService configs, DataAdapterRegistry adapters) {
        this.admin = admin;
        this.configs = configs;
        this.adapters = adapters;
    }

    private record ObjectType(String name, String pk, String label, List<String> searchFields, boolean hasBusinessName) {}
    private record Relation(String type, ObjectType from, ObjectType to) {}

    static String identifier(String value) {
        if (value == null || !value.matches("[A-Za-z_][A-Za-z0-9_]*"))
            throw new IllegalArgumentException("Unsupported SQL identifier in ontology: " + value);
        return value;
    }

    @SuppressWarnings("unchecked")
    public JSONObject query(String operation, JSONObject request, String domainId) {
        if (!permits.tryAcquire()) throw new IllegalStateException("Graph queries are busy. Please retry.");
        try {
            var config = configs.get(domainId);
            SchemaSnapshot snapshot = schema(domainId);
            String version = snapshot.version;
            if (request.getString("version") != null && !version.equals(request.getString("version")))
                return JSONObject.of("success", false, "code", "GRAPH_VERSION_CHANGED", "message", "Ontology changed. Reload the overview.");
            String cacheKey = domainId + ":" + version + ":" + config.getDataAdapterConnections().hashCode();
            if ("statistics".equals(operation)) {
                CachedStatistics cached = statisticsCache.get(cacheKey);
                if (cached != null && cached.expiresAt > System.currentTimeMillis())
                    return ready(cached.data);
            }
            if ("summary".equals(operation)) {
                CachedOverview cached = overviewCache.get(cacheKey);
                if (cached != null && cached.expiresAt > System.currentTimeMillis())
                    return ready(cached.data);
            }
            DataAdapter adapter = adapters.create(config, snapshot.schema);
            Supplier<DataAdapter> adapterFactory = () -> adapters.create(config, snapshot.schema);
            AdapterPool pool = new AdapterPool(adapterFactory);
            JSONObject data = switch (operation) {
                case "summary" -> cachedOverview(adapter, pool, snapshot.types, snapshot.relations, version, cacheKey);
                case "statistics" -> cachedStatistics(adapter, pool, snapshot.types, cacheKey);
                case "search" -> search(adapter, snapshot.types, request, version);
                case "neighborhood" -> neighborhood(adapter, snapshot.types, snapshot.relations, request, version);
                default -> throw new IllegalArgumentException("Unknown graph operation");
            };
            return ready(data);
        } catch (CompletionException e) {
            Throwable cause = e.getCause() == null ? e : e.getCause();
            return JSONObject.of("success", false, "message", cause.getMessage());
        } catch (Exception e) {
            return JSONObject.of("success", false, "message", e.getMessage());
        } finally {
            permits.release();
        }
    }

    private JSONObject ready(JSONObject data) {
        return JSONObject.of("success", true, "status", "READY", "data", data);
    }

    /** Cached overview with single-flight: concurrent readers of the same version wait for one build. */
    private JSONObject cachedOverview(DataAdapter adapter, AdapterPool pool,
            Map<String, ObjectType> types, List<Relation> relations, String version, String cacheKey) throws Exception {
        CachedOverview cached = overviewCache.get(cacheKey);
        if (cached != null && cached.expiresAt > System.currentTimeMillis()) return cached.data;
        CompletableFuture<JSONObject> future = new CompletableFuture<>();
        CompletableFuture<JSONObject> running = overviewBuilds.putIfAbsent(cacheKey, future);
        if (running != null) return running.join();
        try {
            cached = overviewCache.get(cacheKey);
            if (cached != null && cached.expiresAt > System.currentTimeMillis()) {
                future.complete(cached.data);
                return cached.data;
            }
            JSONObject data = overview(adapter, pool, types, relations, version, cacheKey);
            long now = System.currentTimeMillis();
            overviewCache.entrySet().removeIf(entry -> entry.getValue().expiresAt <= now);
            overviewCache.put(cacheKey, new CachedOverview(now + OVERVIEW_TTL_MS, data));
            future.complete(data);
            return data;
        } catch (Throwable error) {
            future.completeExceptionally(error);
            throw error;
        } finally {
            overviewBuilds.remove(cacheKey, future);
        }
    }

    private JSONObject cachedStatistics(DataAdapter adapter, AdapterPool pool,
            Map<String, ObjectType> types, String cacheKey) throws Exception {
        CachedStatistics cached = statisticsCache.get(cacheKey);
        if (cached != null && cached.expiresAt > System.currentTimeMillis()) return cached.data;
        JSONObject data = statistics(adapter, pool, types);
        long now = System.currentTimeMillis();
        statisticsCache.entrySet().removeIf(entry -> entry.getValue().expiresAt <= now);
        statisticsCache.put(cacheKey, new CachedStatistics(now + STATISTICS_TTL_MS, data));
        return data;
    }

    /** Parsed ontology snapshot; the short TTL removes the per-request JSON parse without hiding edits for long. */
    private SchemaSnapshot schema(String domainId) {
        long now = System.currentTimeMillis();
        SchemaSnapshot cached = schemaSnapshots.get(domainId);
        if (cached != null && cached.expiresAt > now) return cached;
        Map<String, Object> schema = admin.getJSONRule(domainId);
        Map<String, ObjectType> types = objectTypes(schema);
        List<Relation> relations = relations(schema, types);
        String version = Integer.toHexString(schema.toString().hashCode());
        SchemaSnapshot snapshot = new SchemaSnapshot(version, schema, types, relations, now + SCHEMA_TTL_MS);
        schemaSnapshots.put(domainId, snapshot);
        return snapshot;
    }

    // ----------------------------------------------------------------------------------
    // Schema parsing
    // ----------------------------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private Map<String, ObjectType> objectTypes(Map<String, Object> schema) {
        Map<String, ObjectType> types = new LinkedHashMap<>();
        for (var def : (List<Map<String, Object>>) schema.get("classDef")) {
            String name = (String) def.get("className");
            String pk = identifier(DslUtil.getPrimaryKey(def));
            List<String> searchFields = new ArrayList<>();
            for (var attr : (List<Map<String, Object>>) def.get("attrs")) {
                String field = (String) attr.get("name");
                if (Boolean.FALSE.equals(attr.get("enable"))) continue;
                if (field.matches("(?:.*_)?(?:name|title)(?:_.*)?")
                        && ("varchar".equals(attr.get("type")) || "text".equals(attr.get("type")))) {
                    searchFields.add(identifier(field));
                }
            }
            String businessKey = io.ontomato.dataengine.util.InstanceNameUtil.businessKey(def);
            types.put(name, new ObjectType(name, pk, businessKey == null ? pk : identifier(businessKey), searchFields, businessKey != null));
        }
        return types;
    }

    @SuppressWarnings("unchecked")
    private List<Relation> relations(Map<String, Object> schema, Map<String, ObjectType> types) {
        List<Relation> relations = new ArrayList<>();
        var rules = (Map<String, Map<String, Object>>) schema.get("relationship_rule");
        for (var entry : rules.entrySet()) {
            var rule = entry.getValue();
            ObjectType from = types.get(rule.get("fromclass"));
            ObjectType to = types.get(rule.get("toclass"));
            if (from != null && to != null) relations.add(new Relation(entry.getKey(), from, to));
        }
        relations.sort(Comparator.comparing(Relation::type));
        return relations;
    }

    // ----------------------------------------------------------------------------------
    // Operations
    // ----------------------------------------------------------------------------------

    private JSONObject overview(DataAdapter adapter, AdapterPool pool,
            Map<String, ObjectType> types, List<Relation> relations, String version, String cacheKey) throws Exception {
        JSONObject statistics = cachedStatistics(adapter, pool, types, cacheKey);
        Map<String, Long> counts = new LinkedHashMap<>();
        for (Object raw : statistics.getJSONArray("classes")) {
            JSONObject item = (JSONObject) raw;
            counts.put(item.getString("class"), item.getLongValue("instanceCount"));
        }
        Map<String, Integer> quotas = InstanceGraphSampling.quotas(counts);
        Map<String, List<JSONObject>> sampled = new LinkedHashMap<>();
        List<ObjectType> sampledTypes = types.values().stream()
                .filter(type -> quotas.get(type.name) > 0).toList();
        if (sampledTypes.size() >= PARALLEL_THRESHOLD) {
            List<AdapterTask<List<JSONObject>>> tasks = sampledTypes.stream()
                    .map(type -> (AdapterTask<List<JSONObject>>) taskAdapter ->
                            sampleRows(taskAdapter, type, quotas.get(type.name)))
                    .toList();
            List<List<JSONObject>> results = parallel(tasks, pool);
            for (int i = 0; i < sampledTypes.size(); i++) sampled.put(sampledTypes.get(i).name, results.get(i));
        } else {
            for (ObjectType type : sampledTypes) sampled.put(type.name, sampleRows(adapter, type, quotas.get(type.name)));
        }
        Map<String, List<String>> ids = new LinkedHashMap<>();
        JSONArray nodes = new JSONArray(), edges = new JSONArray(), classes = new JSONArray();
        for (ObjectType type : types.values()) {
            List<String> keys = new ArrayList<>();
            for (JSONObject row : sampled.getOrDefault(type.name, List.of())) {
                nodes.add(node(type, row));
                keys.add(row.getString("pk"));
            }
            ids.put(type.name, keys);
            classes.add(JSONObject.of("class", type.name, "sampleCount", keys.size(), "instanceCount", counts.get(type.name)));
        }
        boolean truncated = false;
        if (relations.size() < PARALLEL_THRESHOLD) {
            relationLoop:
            for (Relation relation : relations) {
                int remaining = MAX_OVERVIEW_EDGES - edges.size();
                if (remaining <= 0) { truncated = true; break; }
                List<String> from = ids.get(relation.from.name), to = ids.get(relation.to.name);
                if (from.isEmpty() || to.isEmpty()) continue;
                for (JSONObject row : runDsl(adapter, relationDsl(relation, from, to, remaining + 1))) {
                    if (edges.size() == MAX_OVERVIEW_EDGES) { truncated = true; break relationLoop; }
                    addOverviewEdge(edges, relation, row);
                }
            }
        } else {
            relationLoop:
            for (int index = 0; index < relations.size(); ) {
                int remaining = MAX_OVERVIEW_EDGES - edges.size();
                if (remaining <= 0) { truncated = true; break; }
                int end = Math.min(index + PARALLEL_THRESHOLD, relations.size());
                List<Relation> active = new ArrayList<>();
                List<AdapterTask<List<JSONObject>>> tasks = new ArrayList<>();
                for (Relation relation : relations.subList(index, end)) {
                    List<String> from = ids.get(relation.from.name), to = ids.get(relation.to.name);
                    if (from.isEmpty() || to.isEmpty()) continue;
                    active.add(relation);
                    tasks.add(taskAdapter -> runDsl(taskAdapter, relationDsl(relation, from, to, remaining + 1)));
                }
                List<List<JSONObject>> results = parallel(tasks, pool);
                for (int i = 0; i < active.size(); i++) {
                    Relation relation = active.get(i);
                    for (JSONObject row : results.get(i)) {
                        if (edges.size() == MAX_OVERVIEW_EDGES) { truncated = true; break relationLoop; }
                        addOverviewEdge(edges, relation, row);
                    }
                }
                index = end;
            }
        }
        return JSONObject.of("classes", classes, "overviewNodes", nodes, "overviewEdges", edges,
                "overviewEdgesTruncated", truncated, "nodeCount", statistics.get("nodeCount"), "edgeCount", null,
                "version", version, "live", true,
                "relationTypes", new JSONArray(relations.stream().map(Relation::type).toList()));
    }

    private JSONObject relationDsl(Relation relation, List<String> from, List<String> to, int limit) {
        return dsl(
                objects(
                        object(0, "f", relation.from.name, conditions(condition(relation.from.pk, "in", array(from)))),
                        object(1, "t", relation.to.name, conditions(condition(relation.to.pk, "in", array(to))))),
                relationships(relation(0, 1, relation.type)),
                fields(field("f", relation.from.pk, "source"), field("t", relation.to.pk, "target")),
                null, limit(limit, 0));
    }

    private void addOverviewEdge(JSONArray edges, Relation relation, JSONObject row) {
        edges.add(JSONObject.of("source", relation.from.name + ":" + row.getString("source"),
                "target", relation.to.name + ":" + row.getString("target"), "type", relation.type));
    }

    private JSONObject statistics(DataAdapter adapter, AdapterPool pool,
            Map<String, ObjectType> types) throws Exception {
        Map<String, Long> counts = new LinkedHashMap<>();
        if (types.size() >= PARALLEL_THRESHOLD) {
            List<ObjectType> ordered = new ArrayList<>(types.values());
            List<AdapterTask<Long>> tasks = ordered.stream()
                    .map(type -> (AdapterTask<Long>) taskAdapter -> countRows(taskAdapter, type)).toList();
            List<Long> results = parallel(tasks, pool);
            for (int i = 0; i < ordered.size(); i++) counts.put(ordered.get(i).name, results.get(i));
        } else {
            for (ObjectType type : types.values()) counts.put(type.name, countRows(adapter, type));
        }
        JSONArray classes = new JSONArray();
        long total = 0;
        for (Map.Entry<String, Long> entry : counts.entrySet()) {
            total += entry.getValue();
            classes.add(JSONObject.of("class", entry.getKey(), "instanceCount", entry.getValue()));
        }
        return JSONObject.of("nodeCount", total, "classes", classes);
    }

    private long countRows(DataAdapter adapter, ObjectType type) throws Exception {
        JSONObject dsl = dsl(objects(object(0, "n", type.name, null)), null,
                fields(aggField("n", type.pk, "count", "cnt")), null, null);
        List<JSONObject> rows = runDsl(adapter, dsl);
        return rows.isEmpty() ? 0 : ((Number) rows.get(0).get("cnt")).longValue();
    }

    private List<JSONObject> sampleRows(DataAdapter adapter, ObjectType type, int quota) throws Exception {
        JSONObject dsl = dsl(objects(object(0, "n", type.name, null)), null,
                fields(field("n", type.pk, "pk"), field("n", type.label, "name")),
                sort(sortField("pk")), limit(quota, 0));
        return runDsl(adapter, dsl);
    }

    /** Runs bounded independent reads on the shared pool; each task leases its own adapter instance. */
    private <T> List<T> parallel(List<AdapterTask<T>> tasks, AdapterPool pool) throws Exception {
        if (tasks.isEmpty()) return List.of();
        List<CompletableFuture<T>> futures = new ArrayList<>();
        for (AdapterTask<T> task : tasks) {
            futures.add(CompletableFuture.supplyAsync(() -> {
                DataAdapter taskAdapter;
                try {
                    taskAdapter = pool.acquire();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new CompletionException(e);
                }
                try {
                    return task.run(taskAdapter);
                } catch (Exception e) {
                    throw new CompletionException(e);
                } finally {
                    pool.release(taskAdapter);
                }
            }, QUERY_POOL));
        }
        List<T> results = new ArrayList<>(futures.size());
        for (CompletableFuture<T> future : futures) {
            try {
                results.add(future.join());
            } catch (CompletionException e) {
                Throwable cause = e.getCause();
                if (cause instanceof Exception exception) throw exception;
                if (cause instanceof Error error) throw error;
                throw e;
            }
        }
        return results;
    }

    private JSONObject search(DataAdapter adapter, Map<String, ObjectType> types, JSONObject request, String version) throws Exception {
        JSONArray nodes = new JSONArray();
        String term = request.getString("term");
        term = term == null ? "" : term.trim();
        for (ObjectType type : types.values()) {
            if (request.getString("class") != null && !type.name.equals(request.getString("class"))) continue;
            String effectiveTerm = type.name.toLowerCase(Locale.ROOT).contains(term.toLowerCase(Locale.ROOT)) ? "" : term;
            JSONObject conditions = null;
            if (!effectiveTerm.isEmpty()) {
                JSONObject or = new JSONObject();
                or.put("operator", "logic");
                JSONArray ors = new JSONArray();
                ors.add(condition(type.pk, "like", effectiveTerm));
                if (!type.label.equals(type.pk)) ors.add(condition(type.label, "like", effectiveTerm));
                for (String field : type.searchFields) {
                    if (!field.equals(type.pk) && !field.equals(type.label)) ors.add(condition(field, "like", effectiveTerm));
                }
                or.put("or", ors);
                conditions = conditions(or);
            }
            JSONObject dsl = dsl(objects(object(0, "n", type.name, conditions)), null,
                    fields(field("n", type.pk, "pk"), field("n", type.label, "name")),
                    sort(sortField("pk")), limit(51, 0));
            for (JSONObject row : runDsl(adapter, dsl)) {
                nodes.add(node(type, row));
                if (nodes.size() > 50) break;
            }
            if (nodes.size() > 50) break;
        }
        boolean more = nodes.size() > 50;
        if (more) nodes.remove(50);
        return JSONObject.of("nodes", nodes, "hasMore", more, "version", version);
    }

    private JSONObject neighborhood(DataAdapter adapter, Map<String, ObjectType> types, List<Relation> relations, JSONObject request, String version) throws Exception {
        String id = request.getString("id");
        int separator = id == null ? -1 : id.indexOf(':');
        if (separator < 1) throw new IllegalArgumentException("Invalid instance id");
        ObjectType center = types.get(id.substring(0, separator));
        if (center == null) throw new IllegalArgumentException("Unknown object type");
        String key = id.substring(separator + 1);
        String direction = request.getString("direction");
        if (direction != null && !List.of("both", "incoming", "outgoing").contains(direction))
            throw new IllegalArgumentException("Unknown direction");
        int offset = request.getIntValue("offset");
        if (offset < 0 || offset > 2000) throw new IllegalArgumentException("Invalid offset");

        JSONObject centerDsl = dsl(objects(object(0, "n", center.name, conditions(condition(center.pk, "=", key)))),
                null, fields(field("n", center.pk, "pk"), field("n", center.label, "name")), null, limit(1, 0));
        List<JSONObject> centerRows = runDsl(adapter, centerDsl);
        if (centerRows.isEmpty()) throw new IllegalArgumentException("Instance no longer exists");
        Map<String, JSONObject> nodes = new LinkedHashMap<>();
        nodes.put(id, node(center, centerRows.get(0)));

        List<JSONObject> neighborRows = new ArrayList<>();
        // Every relation group only needs its own top slice for the requested page, never the full neighbourhood.
        int fetchLimit = offset + PAGE_SIZE + 1;
        boolean truncated = false;
        for (Relation relation : relations) {
            boolean outgoingAllowed = relation.from.name.equals(center.name) && !"incoming".equals(direction);
            boolean incomingAllowed = relation.to.name.equals(center.name) && !"outgoing".equals(direction);
            if (request.getString("neighborClass") != null) {
                if (outgoingAllowed && !relation.to.name.equals(request.getString("neighborClass"))) outgoingAllowed = false;
                if (incomingAllowed && !relation.from.name.equals(request.getString("neighborClass"))) incomingAllowed = false;
            }
            if (request.getString("relationType") != null && !relation.type.equals(request.getString("relationType"))) {
                outgoingAllowed = false;
                incomingAllowed = false;
            }
            boolean selfLoop = relation.from.name.equals(relation.to.name);
            if (outgoingAllowed) {
                JSONObject fromObj = object(0, "f", relation.from.name, conditions(condition(relation.from.pk, "=", key)));
                JSONObject toObj = object(1, "t", relation.to.name, null);
                JSONObject dsl = dsl(objects(fromObj, toObj), relationships(relation(0, 1, relation.type)),
                        fields(field("t", relation.to.pk, "pk"), field("t", relation.to.label, "name")), null,
                        limit(fetchLimit, 0));
                List<JSONObject> rows = runDsl(adapter, dsl);
                if (rows.size() >= fetchLimit) truncated = true;
                for (JSONObject row : rows) {
                    neighborRows.add(JSONObject.of("type", relation.type, "class", relation.to.name,
                            "pk", row.getString("pk"), "name", row.getString("name"), "outgoing", true));
                }
            }
            if (incomingAllowed) {
                JSONObject fromObj = object(0, "f", relation.from.name, null);
                JSONObject toObj = object(1, "t", relation.to.name, conditions(condition(relation.to.pk, "=", key)));
                // A self-loop relation in the incoming direction must not list the node as its own neighbour.
                if (selfLoop) {
                    fromObj.put("conditions", conditions(condition(relation.from.pk, "!=", key)));
                }
                JSONObject dsl = dsl(objects(fromObj, toObj), relationships(relation(0, 1, relation.type)),
                        fields(field("f", relation.from.pk, "pk"), field("f", relation.from.label, "name")), null,
                        limit(fetchLimit, 0));
                List<JSONObject> rows = runDsl(adapter, dsl);
                if (rows.size() >= fetchLimit) truncated = true;
                for (JSONObject row : rows) {
                    neighborRows.add(JSONObject.of("type", relation.type, "class", relation.from.name,
                            "pk", row.getString("pk"), "name", row.getString("name"), "outgoing", false));
                }
            }
        }

        Map<String, JSONObject> unique = new LinkedHashMap<>();
        for (JSONObject n : neighborRows) {
            unique.putIfAbsent(n.getString("type") + "|" + n.getString("class") + "|" + n.getString("pk") + "|" + n.getBooleanValue("outgoing"), n);
        }
        List<JSONObject> sorted = new ArrayList<>(unique.values());
        sorted.sort(Comparator.comparing((JSONObject n) -> n.getString("type"))
                .thenComparing(n -> n.getString("class"))
                .thenComparing(n -> n.getString("pk"))
                .thenComparing(n -> n.getBooleanValue("outgoing")));
        int end = Math.min(offset + PAGE_SIZE, sorted.size());
        boolean more = truncated || end < sorted.size();
        JSONArray edges = new JSONArray();
        for (int i = offset; i < end; i++) {
            JSONObject n = sorted.get(i);
            String otherId = n.getString("class") + ":" + n.getString("pk");
            nodes.putIfAbsent(otherId, JSONObject.of("id", otherId, "class", n.getString("class"), "name", n.getString("name")));
            edges.add(JSONObject.of("source", n.getBooleanValue("outgoing") ? id : otherId,
                    "target", n.getBooleanValue("outgoing") ? otherId : id, "type", n.getString("type")));
        }
        return JSONObject.of("nodes", new JSONArray(nodes.values()), "edges", edges,
                "total", more ? null : offset + edges.size(),
                "nextOffset", more ? offset + edges.size() : null, "version", version);
    }

    // ----------------------------------------------------------------------------------
    // DSL building and execution
    // ----------------------------------------------------------------------------------

    private List<JSONObject> runDsl(DataAdapter adapter, JSONObject dsl) throws Exception {
        JSONArray dsls = new JSONArray();
        dsls.add(dsl);
        String result = adapter.executeDsl(dsls.toJSONString(), UUID.randomUUID().toString(), DslExecutionMode.RAW, new ArrayList<>());
        JSONArray answer = JSON.parseArray(result).getJSONObject(0).getJSONArray("answer");
        List<JSONObject> rows = new ArrayList<>();
        if (answer != null) for (Object raw : answer) rows.add((JSONObject) raw);
        return rows;
    }

    private JSONObject node(ObjectType type, JSONObject row) {
        return JSONObject.of("id", type.name + ":" + row.getString("pk"), "class", type.name,
                "name", type.hasBusinessName && row.getString("name") != null && !row.getString("name").isBlank() ? row.getString("name") : "—");
    }

    private JSONObject dsl(JSONArray objects, JSONArray relationships, JSONArray outputFields, JSONObject sort, JSONObject limit) {
        JSONObject pattern = new JSONObject();
        pattern.put("objects", objects);
        if (relationships != null && !relationships.isEmpty()) pattern.put("relationship", relationships);
        JSONArray patterns = new JSONArray();
        patterns.add(pattern);
        JSONObject graph = new JSONObject();
        graph.put("patterns", patterns);
        graph.put("pattern_logic", "and");
        JSONObject step = new JSONObject();
        step.put("graph", graph);
        JSONObject output = new JSONObject();
        output.put("to_user", true);
        output.put("fields", outputFields);
        if (sort != null) output.put("sort", sort);
        if (limit != null) output.put("limit", limit);
        step.put("output", output);
        JSONArray steps = new JSONArray();
        steps.add(step);
        JSONObject answer = new JSONObject();
        answer.put("steps", steps);
        JSONObject dsl = new JSONObject();
        dsl.put("problem", "");
        dsl.put("answer", answer);
        return dsl;
    }

    private JSONArray objects(JSONObject... os) {
        JSONArray arr = new JSONArray();
        for (JSONObject o : os) arr.add(o);
        return arr;
    }

    private JSONArray relationships(JSONObject... rs) {
        JSONArray arr = new JSONArray();
        for (JSONObject r : rs) arr.add(r);
        return arr;
    }

    private JSONArray fields(JSONObject... fs) {
        JSONArray arr = new JSONArray();
        for (JSONObject f : fs) arr.add(f);
        return arr;
    }

    private JSONObject object(int idx, String variable, String className, JSONObject conditions) {
        JSONObject o = new JSONObject();
        o.put("idx", idx);
        o.put("variable", variable);
        o.put("class", className);
        if (conditions != null) o.put("conditions", conditions);
        return o;
    }

    private JSONObject field(String variable, String field, String as) {
        JSONObject f = new JSONObject();
        f.put("variable", variable);
        f.put("field", field);
        f.put("as", as);
        return f;
    }

    private JSONObject aggField(String variable, String field, String function, String as) {
        JSONObject f = field(variable, field, as);
        f.put("function", function);
        return f;
    }

    private JSONObject condition(String field, String operator, Object value) {
        JSONObject c = new JSONObject();
        c.put("field", field);
        c.put("operator", operator);
        c.put("value", value);
        return c;
    }

    private JSONObject conditions(JSONObject properties) {
        JSONObject c = new JSONObject();
        c.put("properties", properties);
        return c;
    }

    private JSONObject relation(int from, int to, String type) {
        JSONObject r = new JSONObject();
        r.put("from", from);
        r.put("to", to);
        JSONArray types = new JSONArray();
        types.add(type);
        r.put("type", types);
        return r;
    }

    private JSONObject sortField(String field) {
        JSONObject f = new JSONObject();
        f.put("field", field);
        return f;
    }

    private JSONObject sort(JSONObject... fields) {
        JSONObject s = new JSONObject();
        JSONArray arr = new JSONArray();
        for (JSONObject f : fields) arr.add(f);
        s.put("fields", arr);
        return s;
    }

    private JSONObject limit(int count, int offset) {
        JSONObject l = new JSONObject();
        l.put("count", count);
        l.put("offset", offset);
        return l;
    }

    private JSONArray array(List<String> values) {
        JSONArray arr = new JSONArray();
        for (String v : values) arr.add(v);
        return arr;
    }
}

package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.panelreads.WorkbenchPanelRead;
import io.ontomato.dataengine.service.DataService;
import io.ontomato.dataengine.service.DslService;
import io.ontomato.dataengine.service.ExecutionTarget;
import io.ontomato.dataengine.service.OntologyModelException;
import io.ontomato.dataengine.service.OntologyModelService.AttributeView;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Owner facts for ordinary registered customer-object reads with request-captured data authority. */
@Configuration(proxyBeanMethods = false)
class CustomerRecordPanelReads {
    private static final String CUSTOMER = "customer:ObjectType";
    private static final String OBJECT_TYPE = "platform:ObjectType";

    private final OntologyModelPanelReads model;
    private final DataService data;
    private final DslService dsl;

    CustomerRecordPanelReads(OntologyModelPanelReads model, DataService data, DslService dsl) {
        this.model = model;
        this.data = data;
        this.dsl = dsl;
    }

    record Facts(List<AttributeView> attributes, JSONObject answer) {}
    record DirectionFacts(String direction, String targetClass, String status, JSONArray rows, String reason) {}
    record NeighborFacts(Facts anchor, String label, Map<String, String> typeLabels,
                         Map<String, List<AttributeView>> targetAttributes, List<DirectionFacts> directions) {}

    @Bean
    WorkbenchPanelRead customerRelationshipNeighbors() {
        return WorkbenchPanelRead.callerScopedLiveData("customer:Relationship", "neighbors", this::neighbors);
    }

    private NeighborFacts neighbors(SubjectContext subject, Map<String, Object> parameters, ExecutionTarget target) {
        String relationshipId = primaryKey(parameters.get("relationshipId"));
        if (!(parameters.get("node") instanceof Map<?, ?> node)) throw invalid("Expected a center node");
        String className = scopedClassName(node.get("className"), target);
        String key = primaryKey(node.get("primaryKey"));
        int limit = positiveInteger(parameters, "limit");
        if (limit > 100) throw invalid("Expected a neighbor limit of at most 100");
        Object rawOffset = parameters.get("offset");
        if (!(rawOffset instanceof Integer || rawOffset instanceof Long) || ((Number) rawOffset).longValue() < 0)
            throw invalid("Expected a nonnegative offset");
        long offset = ((Number) rawOffset).longValue();
        String language = language();
        var attributes = classAttributes(subject, className, language);
        var anchor = recordFacts(subject, className, key, language, attributes);
        if (!anchor.answer().getBooleanValue("success"))
            return new NeighborFacts(anchor, null, Map.of(), Map.of(), List.of());
        // The record owner includes the full class definition. Neighbors only need the permitted row.
        anchor = new Facts(attributes, JSONObject.of("success", true, "data",
                JSONObject.of("data", anchor.answer().getJSONObject("data").getJSONObject("data"))));

        var catalog = model.classRelationships(subject, className, language, target);
        var relation = catalog.stream().filter(row -> row.relationship().equals(relationshipId)).findFirst();
        var typeLabels = new LinkedHashMap<String, String>();
        for (var row : catalog) {
            if (!row.fromShowName().isEmpty()) typeLabels.put(row.fromclass(), row.fromShowName());
            if (!row.toShowName().isEmpty()) typeLabels.put(row.toclass(), row.toShowName());
        }
        if (relation.isEmpty()) {
            typeLabels.keySet().retainAll(List.of(className));
            return new NeighborFacts(anchor, null, typeLabels, Map.of(), List.of());
        }

        var definition = relation.get();
        boolean outgoing = className.equals(definition.fromclass());
        boolean incoming = className.equals(definition.toclass());
        String targetClass = outgoing ? definition.toclass() : definition.fromclass();
        boolean self = outgoing && incoming;
        var targetAttributes = self ? attributes : classAttributes(subject, targetClass, language);
        long queryOffset = self ? 0 : offset;
        long queryCount = offset - queryOffset + limit + 1;
        var directions = new ArrayList<DirectionFacts>(2);
        if (outgoing) directions.add(readDirection(subject, className, key, keyAttribute(attributes),
                relationshipId, targetClass, targetAttributes, true, queryCount, queryOffset));
        if (incoming) directions.add(readDirection(subject, className, key, keyAttribute(attributes),
                relationshipId, targetClass, targetAttributes, false, queryCount, queryOffset));
        typeLabels.keySet().retainAll(List.of(className, targetClass));
        return new NeighborFacts(anchor, definition.desc().isEmpty() ? relationshipId : definition.desc(),
                typeLabels, self ? Map.of() : Map.of(targetClass, targetAttributes), directions);
    }

    private DirectionFacts readDirection(SubjectContext subject, String className, String key, String keyAttribute,
                                         String relation, String targetClass, List<AttributeView> targetAttributes,
                                         boolean outgoing, long count, long offset) {
        String direction = outgoing ? "outgoing" : "incoming";
        String targetKey = keyAttribute(targetAttributes);
        var fields = new JSONArray();
        fields.add(JSONObject.of("variable", "target", "field", targetKey, "as", targetKey, "distinct", true));
        for (var attribute : targetAttributes) {
            if (attribute.enable() && attribute.businessKey() && !targetKey.equals(attribute.name()))
                fields.add(JSONObject.of("variable", "target", "field", attribute.name(), "as", attribute.name()));
        }
        var source = JSONObject.of("idx", 0, "variable", "source", "class", className, "conditions",
                JSONObject.of("properties", JSONObject.of("field", keyAttribute, "operator", "=", "value", key)));
        var target = JSONObject.of("idx", 1, "variable", "target", "class", targetClass);
        var edge = JSONObject.of("from", outgoing ? 0 : 1, "to", outgoing ? 1 : 0, "type", JSONArray.of(relation));
        var pattern = JSONObject.of("objects", JSONArray.of(source, target), "relationship", JSONArray.of(edge));
        var graph = JSONObject.of("pattern_logic", "and", "patterns", JSONArray.of(pattern));
        var sort = JSONObject.of("fields", JSONArray.of(JSONObject.of("variable", "target", "field", targetKey, "order", "asc")));
        var output = JSONObject.of("to_user", true, "fields", fields, "sort", sort,
                "limit", JSONObject.of("count", count, "offset", offset));
        var query = JSONObject.of("problem", "", "answer",
                JSONObject.of("steps", JSONArray.of(JSONObject.of("graph", graph, "output", output))));
        try {
            var answer = new JSONObject(dsl.executeV1ForDomain(query, subject.liveDataPermission(), subject.identity().domainId()));
            if (answer.containsKey("error"))
                return new DirectionFacts(direction, targetClass, "failed", null, null);
            return new DirectionFacts(direction, targetClass, "ok",
                    answer.getJSONArray("data").getJSONObject(0).getJSONArray("answer"), null);
        } catch (ResponseStatusException refusal) {
            int status = refusal.getStatusCode().value();
            if (status == 401 || status == 403)
                return new DirectionFacts(direction, targetClass, "refused", null, refusal.getReason());
            throw refusal;
        }
    }

    private static String keyAttribute(List<AttributeView> attributes) {
        return attributes.stream().filter(AttributeView::primaryKey).findFirst().orElseThrow().name();
    }

    @Bean
    WorkbenchPanelRead customerQuery() {
        return WorkbenchPanelRead.callerScopedLiveData(CUSTOMER, "query", this::query);
    }

    @Bean
    WorkbenchPanelRead customerRecord() {
        return WorkbenchPanelRead.callerScopedLiveData(CUSTOMER, "record",
                (subject, parameters, target) -> record(subject, parameters, target, false));
    }

    @Bean
    WorkbenchPanelRead customerFavoriteRecords() {
        return WorkbenchPanelRead.callerScopedLiveData(CUSTOMER, "favoriteRecords", this::favoriteRecords);
    }

    private List<Facts> favoriteRecords(SubjectContext subject, Map<String, Object> parameters, ExecutionTarget target) {
        if (!(parameters.get("objects") instanceof List<?> objects)) throw invalid("Expected favorite objects");
        var records = new ArrayList<Facts>(objects.size());
        for (var item : objects) {
            if (!(item instanceof Map<?, ?> object)) throw invalid("Expected a favorite object");
            records.add(favoriteRecord(subject, object, target));
        }
        return records;
    }

    private Facts favoriteRecord(SubjectContext subject, Map<?, ?> object, ExecutionTarget target) {
        try {
            return record(subject, object, target, false);
        } catch (ResponseStatusException failure) {
            int status = failure.getStatusCode().value();
            if (status == 403 || status == 404) return null;
            throw failure;
        } catch (OwnerRefusal refusal) {
            if ("OBJECT_TYPE_NOT_FOUND".equals(refusal.code())) return null;
            throw refusal;
        }
    }

    @Bean
    WorkbenchPanelRead customerForm() {
        return WorkbenchPanelRead.callerScopedLiveData(CUSTOMER, "form",
                (subject, parameters, target) -> record(subject, parameters, target, true));
    }

    @Bean
    WorkbenchPanelRead customerCreateForm() {
        return WorkbenchPanelRead.callerScopedMetadata(CUSTOMER, "createForm", (subject, parameters, target) ->
            Map.of("attributes", classAttributes(subject, scopedClassName(parameters.get("className"), target), language())));
    }

    @Bean
    WorkbenchPanelRead objectTypeInstances() {
        return WorkbenchPanelRead.callerScopedLiveData(OBJECT_TYPE, "instances", this::query);
    }

    @Bean
    WorkbenchPanelRead objectTypeInstanceRecord() {
        return WorkbenchPanelRead.callerScopedLiveData(OBJECT_TYPE, "instanceRecord", (subject, parameters, target) -> {
            String className = scopedClassName(parameters.get("className"), target);
            String primaryKey = primaryKey(parameters.get("primaryKey"));
            String language = language();
            var definition = modelFacts(() -> model.instanceModel(subject, className, language));
            return Map.of("record", recordFacts(subject, className, primaryKey, language, definition.attributes()),
                "type", definition.type());
        });
    }

    @Bean
    WorkbenchPanelRead objectTypeInstanceNeighbors() {
        return instanceGraph("instanceNeighbors", "neighborhood");
    }

    @Bean
    WorkbenchPanelRead objectTypeInstanceGraphOverview() {
        return instanceGraph("instanceGraphOverview", "nodes");
    }

    @Bean
    WorkbenchPanelRead objectTypeInstanceGraphConnections() {
        return instanceGraph("instanceGraphConnections", "connections");
    }

    @Bean
    WorkbenchPanelRead objectTypeInstanceGraphStatistics() {
        return instanceGraph("instanceGraphStatistics", "statistics");
    }

    @Bean
    WorkbenchPanelRead objectTypeInstanceGraphClasses() {
        return instanceGraph("instanceGraphClasses", "nodes");
    }

    @Bean
    WorkbenchPanelRead objectTypeInstanceGraphSearch() {
        return instanceGraph("instanceGraphSearch", "search");
    }

    private WorkbenchPanelRead instanceGraph(String read, String operation) {
        return WorkbenchPanelRead.liveData(OBJECT_TYPE, read, (subject, parameters) ->
            data.queryInstanceGraph(operation, new JSONObject(parameters), subject.liveDataPermission(), subject.identity().domainId()));
    }

    private Facts query(SubjectContext subject, Map<String, Object> parameters, ExecutionTarget target) {
        String className = scopedClassName(parameters.get("classname"), target);
        var page = JSONObject.of("classname", className,
                "pagenum", positiveInteger(parameters, "pagenum"),
                "pagecount", positiveInteger(parameters, "pagecount"));
        if (parameters.get("search") instanceof String search) page.put("search", search);
        else if (parameters.get("search") != null) throw invalid("Expected a search string");
        // The object data owner validates the shape and readability of filter and sort fields.
        if (parameters.containsKey("filters")) page.put("filters", parameters.get("filters"));
        if (parameters.containsKey("sort")) page.put("sort", parameters.get("sort"));
        String language = language();
        var attributes = classAttributes(subject, className, language);
        var answer = data.getWholeClassDataByPage(page, language, subject.liveDataPermission(), subject.identity().domainId());
        return new Facts(attributes, answer);
    }

    private Facts record(SubjectContext subject, Map<?, ?> parameters, ExecutionTarget target, boolean requiresPrimaryKey) {
        String className = scopedClassName(parameters.get("className"), target);
        String primaryKey = primaryKey(parameters.get("primaryKey"));
        String language = language();
        var attributes = classAttributes(subject, className, language);
        if (requiresPrimaryKey && attributes.stream().noneMatch(AttributeView::primaryKey))
            throw new OwnerRefusal(null, "Object type '" + className + "' has no primary key attribute");
        return recordFacts(subject, className, primaryKey, language, attributes);
    }

    private Facts recordFacts(SubjectContext subject, String className, String primaryKey, String language, List<AttributeView> attributes) {
        var node = JSONObject.of("class", className, "id", className + ":" + primaryKey);
        var answer = data.queryInfoByNode(node, language, subject.liveDataPermission(), subject.identity().domainId());
        return new Facts(attributes, answer);
    }

    private List<AttributeView> classAttributes(SubjectContext subject, String className, String language) {
        return modelFacts(() -> model.classAttributes(subject, className, language));
    }

    private static <T> T modelFacts(Supplier<T> read) {
        try {
            return read.get();
        } catch (OntologyModelException failure) {
            // Keep the model's missing class visible as a read error, as in the ordinary panel adapter.
            if ("OBJECT_TYPE_NOT_FOUND".equals(failure.code())) throw new OwnerRefusal(failure.code(), failure.getMessage());
            throw failure;
        }
    }

    private static String language() {
        return LocaleContextHolder.getLocale().toLanguageTag();
    }

    private static String primaryKey(Object value) {
        if (!(value instanceof String key) || key.isEmpty()) throw invalid("Expected an object primary key");
        return key;
    }

    private static String scopedClassName(Object value, ExecutionTarget target) {
        String className = className(value);
        target.requireClasses(List.of(className));
        return className;
    }

    private static String className(Object value) {
        if (!(value instanceof String name) || name.isBlank()) throw invalid("Expected an object class name");
        return name;
    }

    private static int positiveInteger(Map<String, Object> parameters, String field) {
        if (!(parameters.get(field) instanceof Integer value) || value < 1)
            throw invalid("Expected a positive integer for " + field);
        return value;
    }

    private static ResponseStatusException invalid(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}

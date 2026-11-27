package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.panelreads.WorkbenchPanelRead;
import io.ontomato.dataengine.service.DataService;
import io.ontomato.dataengine.service.DslService;
import io.ontomato.dataengine.service.ExecutionTarget;
import io.ontomato.dataengine.service.OntologyModelException;
import io.ontomato.dataengine.service.OntologyModelService;
import io.ontomato.dataengine.service.OntologyModelService.AttributeRecord;
import io.ontomato.dataengine.service.OntologyModelService.AttributeRows;
import io.ontomato.dataengine.service.OntologyModelService.AttributeView;
import io.ontomato.dataengine.service.OntologyModelService.FieldLabels;
import io.ontomato.dataengine.service.OntologyModelService.FormDescription;
import io.ontomato.dataengine.service.OntologyModelService.ObjectTypeView;
import io.ontomato.dataengine.service.OntologyModelService.RelationshipView;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.CredentialLimit;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Decision;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Management;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.AuthorizationService.VerifiedIdentity;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.util.List;
import java.util.ArrayList;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

class OntologyModelPanelReadsTest {
    private static final ExecutionTarget MODEL_SCOPE = new ExecutionTarget(null, null, List.of("Order", "Item"), null);
    private final AuthorizationService authorization = mock(AuthorizationService.class);
    private final OntologyModelService model = mock(OntologyModelService.class);
    private final OntologyModelPanelReads panel = new OntologyModelPanelReads(model, authorization);
    private final SubjectContext subject = new SubjectContext(new VerifiedIdentity("d1", "u1", CredentialLimit.UNRESTRICTED),
            null, Map.of(), Set.of(), Set.of());

    @Test
    void deniedManagementReadDoesNotReadTheModel() {
        when(authorization.decide(subject, new Management("ontology-model.read")))
                .thenReturn(new Decision(false, "MANAGEMENT_FORBIDDEN", "denied"));
        var error = assertThrows(ResponseStatusException.class,
                () -> panel.attributeList().handler().read(subject, Map.of("className", "Device")));
        assertEquals(403, error.getStatusCode().value());
        verifyNoInteractions(model);
    }

    @Test
    void scopedModelReadsFilterCataloguesAndCheckBothRelationshipEndpoints() {
        when(authorization.decide(subject, new Management("ontology-model.read"))).thenReturn(new Decision(true, null, null));
        String language = LocaleContextHolder.getLocale().toLanguageTag();
        var fields = new FieldLabels(Map.of(), Map.of(), Map.of());
        when(model.fieldLabels(language)).thenReturn(fields);
        var order = new ObjectTypeView("Order", "Order", "", 1, 0, 1, Map.of(), List.of());
        var customer = new ObjectTypeView("Customer", "Customer", "", 1, 0, 1, Map.of(), List.of());
        when(model.objectTypes("d1", language)).thenReturn(List.of(order, customer));
        when(model.objectType("Order", "d1", language)).thenReturn(order);
        var allowed = new RelationshipView("items", "Order", "Item", "", "id", "id", "", "");
        var outgoing = new RelationshipView("customer", "Order", "Customer", "", "id", "id", "", "");
        var incoming = new RelationshipView("owns", "Customer", "Order", "", "id", "id", "", "");
        when(model.relationships("Order", "d1", language)).thenReturn(List.of(allowed, outgoing, incoming));
        when(model.relationship("items", "d1", language)).thenReturn(allowed);
        when(model.relationship("customer", "d1", language)).thenReturn(outgoing);
        when(model.relationship("owns", "d1", language)).thenReturn(incoming);
        var orderAttribute = attribute("Order", "id", true, false);
        var customerAttribute = attribute("Customer", "id", true, false);
        var labels = Map.of("Order", "Order", "Customer", "Hidden label");
        when(model.attributeRows(null, "d1", language)).thenReturn(new AttributeRows(List.of(orderAttribute, customerAttribute), labels));

        assertEquals(Map.of("views", List.of(order), "fieldLabels", Map.of()), scoped(panel.objectTypeList(), Map.of()));
        assertEquals(List.of(order), scoped(panel.objectTypeOptions(), Map.of()));
        assertEquals(List.of(order), scoped(panel.objectTypeResolve(), Map.of("values", List.of("Order", "Customer"))));
        assertEquals(Map.of("view", order, "fieldLabels", Map.of()), scoped(panel.objectTypeRecord(), Map.of("primaryKey", "Order")));
        assertScopeDenied(panel.objectTypeRecord(), Map.of("primaryKey", "Customer"));
        verify(model, never()).objectType("Customer", "d1", language);
        assertEquals(Map.of("views", List.of(orderAttribute), "classLabels", Map.of("Order", "Order"), "fieldLabels", Map.of()),
                scoped(panel.attributeList(), Map.of()));
        assertScopeDenied(panel.attributeList(), Map.of("className", "Customer"));
        verify(model, never()).attributeRows("Customer", "d1", language);
        assertEquals(Map.of("views", List.of(allowed), "fieldLabels", Map.of()),
                scoped(panel.relationshipList(), Map.of("className", "Order")));
        assertScopeDenied(panel.relationshipList(), Map.of("className", "Customer"));
        assertEquals(Map.of("view", allowed, "fieldLabels", Map.of()), scoped(panel.relationshipRecord(), Map.of("primaryKey", "items")));
        assertScopeDenied(panel.relationshipRecord(), Map.of("primaryKey", "customer"));
        assertScopeDenied(panel.relationshipRecord(), Map.of("primaryKey", "owns"));
        assertEquals(List.of(order, customer), panel.objectTypeOptions().handler().read(subject, Map.of()));
    }

    @Test
    void modelCountsUseTheCallerClassScopeAndKeepLiveTotals() {
        when(authorization.decide(subject, new Management("ontology-model.read"))).thenReturn(new Decision(true, null, null));
        when(model.countMetadata("d1", List.of("Order", "Item")))
                .thenReturn(Map.of("objectTypes", 2, "attributes", 4, "relationships", 1));
        when(model.countMetadata("d1", null)).thenReturn(Map.of("objectTypes", 3, "attributes", 6, "relationships", 4));

        assertEquals(Map.of("rows", List.of(), "total", 2), scoped(panel.objectTypeCount(), Map.of()));
        assertEquals(Map.of("rows", List.of(), "total", 4), scoped(panel.attributeCount(), Map.of()));
        assertEquals(Map.of("rows", List.of(), "total", 1), scoped(panel.relationshipCount(), Map.of()));
        assertEquals(Map.of("rows", List.of(), "total", 3), panel.objectTypeCount().handler().read(subject, Map.of()));
        assertEquals(Map.of("rows", List.of(), "total", 6), panel.attributeCount().handler().read(subject, Map.of()));
        assertEquals(Map.of("rows", List.of(), "total", 4), panel.relationshipCount().handler().read(subject, Map.of()));
    }

    @Test
    void attributeRecordChecksItsOwnerClassOnlyWhenScoped() {
        when(authorization.decide(subject, new Management("ontology-model.read"))).thenReturn(new Decision(true, null, null));
        String language = LocaleContextHolder.getLocale().toLanguageTag();
        var order = attribute("Order", "id", true, false);
        var customer = attribute("Customer", "id", true, false);
        var orderParams = Map.<String, Object>of("primaryKey", "[\"Order\",\"id\"]");
        var customerParams = Map.<String, Object>of("primaryKey", "[\"Customer\",\"id\"]");
        var orderLabels = Map.of("Order", "Order");
        var customerLabels = Map.of("Customer", "Customer");
        when(model.attributeRecord((String) orderParams.get("primaryKey"), "d1", language)).thenReturn(new AttributeRecord(order, orderLabels));
        when(model.attributeRecord((String) customerParams.get("primaryKey"), "d1", language))
                .thenReturn(new AttributeRecord(customer, customerLabels));
        when(model.fieldLabels(language)).thenReturn(new FieldLabels(Map.of(), Map.of(), Map.of()));

        assertEquals(Map.of("view", order, "classLabels", orderLabels, "fieldLabels", Map.of()), scoped(panel.attributeRecord(), orderParams));
        assertScopeDenied(panel.attributeRecord(), customerParams);
        assertEquals(Map.of("view", customer, "classLabels", customerLabels, "fieldLabels", Map.of()),
                panel.attributeRecord().handler().read(subject, customerParams));
    }

    @Test
    void scopedModelFormsCheckExistingTargetsAndSubmittedClassesBeforeDescribingTheForm() {
        when(authorization.decide(subject, new Management("ontology-model.read"))).thenReturn(new Decision(true, null, null));
        String language = LocaleContextHolder.getLocale().toLanguageTag();
        var form = new FormDescription(List.of(), Map.of(), null);
        when(model.objectTypeForm(any(), eq("d1"), eq(language), any(Boolean.class), eq(true))).thenReturn(form);
        when(model.attributeForm(any(), eq("d1"), eq(language), any(Boolean.class), eq(true))).thenReturn(form);
        when(model.relationshipForm(any(), eq("d1"), eq(language), eq(true))).thenReturn(form);
        when(model.relationship("items", "d1", language))
                .thenReturn(new RelationshipView("items", "Order", "Item", "", "id", "id", "", ""));
        when(model.relationship("customer", "d1", language))
                .thenReturn(new RelationshipView("customer", "Order", "Customer", "", "id", "id", "", ""));

        for (var read : List.of(panel.objectTypeForm(), panel.objectTypeInlineForm(), panel.attributeForm(), panel.attributeInlineForm())) {
            boolean attribute = read.type().equals("platform:Attribute");
            String allowed = attribute ? "[\"Order\",\"id\"]" : "Order";
            String denied = attribute ? "[\"Customer\",\"id\"]" : "Customer";
            assertSame(form, scoped(read, Map.of("primaryKey", allowed, "values", Map.of("className", " Item "))), read.name());
            assertScopeDenied(read, Map.of("primaryKey", denied));
            assertScopeDenied(read, Map.of("primaryKey", allowed, "values", Map.of("className", " Customer ")));
        }
        for (var read : List.of(panel.objectTypeCreateForm(), panel.attributeCreateForm())) {
            assertSame(form, scoped(read, Map.of("values", Map.of("className", "Order"))));
            assertScopeDenied(read, Map.of("values", Map.of("className", "Customer")));
        }
        assertSame(form, scoped(panel.relationshipForm(), Map.of("primaryKey", "items", "values", Map.of("toclass", " Item "))));
        assertScopeDenied(panel.relationshipForm(), Map.of("primaryKey", "customer"));
        assertScopeDenied(panel.relationshipForm(), Map.of("primaryKey", "items", "values", Map.of("toclass", "Customer")));
        assertSame(form, scoped(panel.relationshipCreateForm(), Map.of("values", Map.of("fromclass", "Order", "toclass", "Item"))));
        assertScopeDenied(panel.relationshipCreateForm(), Map.of("values", Map.of("fromclass", "Customer", "toclass", "Item")));
        assertScopeDenied(panel.relationshipCreateForm(), Map.of("values", Map.of("fromclass", "Order", "toclass", "Customer")));
        verify(model, times(3)).objectTypeForm(any(), eq("d1"), eq(language), any(Boolean.class), eq(true));
        verify(model, times(3)).attributeForm(any(), eq("d1"), eq(language), any(Boolean.class), eq(true));
        verify(model, times(2)).relationshipForm(any(), eq("d1"), eq(language), eq(true));
    }

    @Test
    void attributeListReturnsItsRowsAndScopedRelationshipFactsIndependently() {
        when(authorization.decide(subject, new Management("ontology-model.read"))).thenReturn(new Decision(true, null, null));
        String language = LocaleContextHolder.getLocale().toLanguageTag();
        var attributes = List.of(attribute("Order", "item", false, false));
        var labels = Map.of("Order", "Order");
        when(model.attributeRows("Order", "d1", language)).thenReturn(new AttributeRows(attributes, labels));
        when(model.fieldLabels(language)).thenReturn(new FieldLabels(Map.of(), Map.of(), Map.of()));
        var allowed = new RelationshipView("items", "Order", "Item", "", "item", "id", "", "");
        var outside = new RelationshipView("customer", "Order", "Customer", "", "item", "id", "", "");
        when(model.relationships("Order", "d1", language))
                .thenReturn(List.of(allowed, outside))
                .thenThrow(new ResponseStatusException(HttpStatus.FORBIDDEN, "Relationship read denied"))
                .thenThrow(new org.springframework.dao.DataRetrievalFailureException("Database error"))
                .thenReturn(List.of(allowed, outside));

        var read = panel.attributeList();
        var parameters = Map.<String, Object>of("className", "Order", "includeDeleteFacts", true);
        var facts = Map.of("views", attributes, "classLabels", labels, "fieldLabels", Map.of());
        assertEquals(facts, scoped(read, Map.of("className", "Order")));
        verify(model, never()).relationships("Order", "d1", language);
        for (var relationshipFacts : List.of(Map.of("views", List.of(allowed)),
                Map.of("error", "Relationship read denied"), Map.of("error", "The owner read failed"))) {
            var expected = new java.util.HashMap<String, Object>(facts);
            expected.put("relationshipFacts", relationshipFacts);
            assertEquals(expected, scoped(read, parameters));
        }
        var unrestricted = (WorkbenchPanelRead.CallerScopedHandler) read.handler();
        var unbounded = new ExecutionTarget(null, null, List.of(), 100L);
        assertEquals(Map.of("views", attributes, "classLabels", labels, "fieldLabels", Map.of(),
                "relationshipFacts", Map.of("views", List.of(allowed, outside))), unrestricted.read(subject, parameters, unbounded));
    }

    private Object scoped(WorkbenchPanelRead read, Map<String, Object> parameters) {
        return ((WorkbenchPanelRead.CallerScopedHandler) read.handler()).read(subject, parameters, MODEL_SCOPE);
    }

    private void assertScopeDenied(WorkbenchPanelRead read, Map<String, Object> parameters) {
        assertEquals(403, assertThrows(ResponseStatusException.class, () -> scoped(read, parameters)).getStatusCode().value(), read.name());
    }

    @Test
    void instanceGraphReadsDelegateToTheLiveDataOwnerWithCapturedPermission() {
        var permission = new UserDataPermission();
        var captured = subject.withLiveDataPermission(permission);
        var data = mock(DataService.class);
        var owner = new CustomerRecordPanelReads(panel, data, mock(DslService.class));
        record GraphRead(WorkbenchPanelRead read, String operation, Map<String, Object> parameters) {}
        var sample = Map.<String, Object>of("version", "schema-v1", "sampleToken", "sample-v1");
        var search = Map.<String, Object>of("term", "Pump", "class", "Device", "version", "schema-v1");
        var node = Map.<String, Object>of("node", Map.of("className", "Device", "primaryKey", "p1"));
        var reply = JSONObject.of("success", true, "status", "GENERATING");
        var reads = List.of(
                new GraphRead(owner.objectTypeInstanceGraphOverview(), "nodes", Map.of()),
                new GraphRead(owner.objectTypeInstanceGraphClasses(), "nodes", Map.of()),
                new GraphRead(owner.objectTypeInstanceGraphConnections(), "connections", sample),
                new GraphRead(owner.objectTypeInstanceGraphStatistics(), "statistics", Map.of()),
                new GraphRead(owner.objectTypeInstanceGraphSearch(), "search", search),
                new GraphRead(owner.objectTypeInstanceNeighbors(), "neighborhood", node));
        for (var graph : reads) {
            when(data.queryInstanceGraph(graph.operation(), new JSONObject(graph.parameters()), permission, "d1", MODEL_SCOPE)).thenReturn(reply);
            assertTrue(graph.read().requiresLiveData());
            assertSame(reply, ((WorkbenchPanelRead.CallerScopedHandler) graph.read().handler())
                    .read(captured, graph.parameters(), MODEL_SCOPE));
        }
        verifyNoInteractions(authorization, model);
    }

    @Test
    void customerRecordReportsRemovedObjectTypesWithTheOwnerCode() {
        var data = mock(DataService.class);
        var owner = new CustomerRecordPanelReads(panel, data, mock(DslService.class));
        var captured = subject.withLiveDataPermission(new UserDataPermission());
        when(authorization.decide(captured, new Management("ontology-model.read")))
                .thenReturn(new Decision(true, null, null));
        when(model.attributes("Removed", "d1", LocaleContextHolder.getLocale().toLanguageTag()))
                .thenThrow(OntologyModelException.notFound("OBJECT_TYPE_NOT_FOUND", "Object type removed"));
        var refusal = assertThrows(OwnerRefusal.class, () -> owner.customerRecord().handler()
                .read(captured, Map.of("className", "Removed", "primaryKey", "id")));
        assertEquals("OBJECT_TYPE_NOT_FOUND", refusal.code());
        verifyNoInteractions(data);
    }

    @Test
    void customerRelationshipUsesTheStoredTargetKeyAndAllEnabledBusinessKeysFromTheIncomingEnd() {
        var data = mock(DataService.class);
        var dsl = mock(DslService.class);
        var permission = new UserDataPermission();
        var captured = subject.withLiveDataPermission(permission);
        var owner = new CustomerRecordPanelReads(panel, data, dsl).customerRelationshipNeighbors();
        String lang = LocaleContextHolder.getLocale().toLanguageTag();
        when(authorization.decide(captured, new Management("ontology-model.read"))).thenReturn(new Decision(true, null, null));
        when(model.attributes("org", "d1", lang)).thenReturn(List.of(attribute("org", "orgId", true, false)));
        var personAttributes = List.of(attribute("person", "personId", true, false), attribute("person", "name", false, true),
                attribute("person", "team", false, true), new AttributeView("person", "disabled", "", "varchar", "", false, true, false));
        when(model.attributes("person", "d1", lang)).thenReturn(personAttributes);
        when(model.relationships("org", "d1", lang)).thenReturn(List.of(
                new RelationshipView("staff", "person", "org", "Staff", "department", "orgId", "Person", "Organization")));
        when(data.queryInfoByNode(JSONObject.of("class", "org", "id", "org:o1"), lang, permission, "d1"))
                .thenReturn(centerRecord());
        var rows = JSONArray.of(JSONObject.of("personId", "p3", "name", "Bob", "team", "Ops"));
        when(dsl.executeV1ForDomain(any(), eq(permission), eq("d1"))).thenAnswer(call -> {
            var step = firstStep(call.getArgument(0));
            var pattern = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0);
            var center = pattern.getJSONArray("objects").getJSONObject(0);
            assertEquals(JSONObject.of("field", "orgId", "operator", "=", "value", "o1"),
                    center.getJSONObject("conditions").getJSONObject("properties"));
            assertEquals(JSONObject.of("from", 1, "to", 0, "type", JSONArray.of("staff")),
                    pattern.getJSONArray("relationship").getJSONObject(0));
            var output = step.getJSONObject("output");
            assertEquals(JSONArray.of(
                    JSONObject.of("variable", "target", "field", "personId", "as", "personId", "distinct", true),
                    JSONObject.of("variable", "target", "field", "name", "as", "name"),
                    JSONObject.of("variable", "target", "field", "team", "as", "team")), output.getJSONArray("fields"));
            assertEquals(JSONObject.of("variable", "target", "field", "personId", "order", "asc"),
                    output.getJSONObject("sort").getJSONArray("fields").getJSONObject(0));
            assertEquals(2, output.getJSONObject("limit").getIntValue("count"));
            assertEquals(1, output.getJSONObject("limit").getIntValue("offset"));
            return JSONObject.of("data", JSONArray.of(JSONObject.of("answer", rows)));
        });

        assertTrue(owner.requiresLiveData());
        var facts = (CustomerRecordPanelReads.NeighborFacts) owner.handler().read(captured, neighbors("staff", "org", "o1", 1, 1));
        assertEquals("Staff", facts.label());
        assertEquals(Map.of("person", personAttributes), facts.targetAttributes());
        assertEquals(List.of(new CustomerRecordPanelReads.DirectionFacts("incoming", "person", "ok", rows, null)), facts.directions());
        assertEquals(JSONObject.of("data", JSONObject.of("name", "Center")), facts.anchor().answer().getJSONObject("data"));
    }

    @Test
    void customerSelfRelationshipReadsBothPrefixesAndKeepsTheOtherDirectionWhenOneIsRefused() {
        var data = mock(DataService.class);
        var dsl = mock(DslService.class);
        var permission = new UserDataPermission();
        var captured = subject.withLiveDataPermission(permission);
        var owner = new CustomerRecordPanelReads(panel, data, dsl).customerRelationshipNeighbors();
        String lang = LocaleContextHolder.getLocale().toLanguageTag();
        when(authorization.decide(captured, new Management("ontology-model.read"))).thenReturn(new Decision(true, null, null));
        when(model.attributes("person", "d1", lang)).thenReturn(List.of(attribute("person", "id", true, false)));
        when(model.relationships("person", "d1", lang)).thenReturn(List.of(
                new RelationshipView("friends", "person", "person", "", "id", "id", "Person", "Person")));
        when(data.queryInfoByNode(JSONObject.of("class", "person", "id", "person:p1"), lang, permission, "d1"))
                .thenReturn(centerRecord());
        var from = new ArrayList<Integer>();
        var rows = JSONArray.of(JSONObject.of("id", "p1"));
        when(dsl.executeV1ForDomain(any(), eq(permission), eq("d1"))).thenAnswer(call -> {
            var step = firstStep(call.getArgument(0));
            var limit = step.getJSONObject("output").getJSONObject("limit");
            assertEquals(3, limit.getIntValue("count"));
            assertEquals(0, limit.getIntValue("offset"));
            var pattern = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0);
            int direction = pattern.getJSONArray("relationship").getJSONObject(0).getIntValue("from");
            from.add(direction);
            if (direction == 1) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Incoming refused");
            return JSONObject.of("data", JSONArray.of(JSONObject.of("answer", rows)));
        });
        var facts = (CustomerRecordPanelReads.NeighborFacts) owner.handler().read(captured, neighbors("friends", "person", "p1", 1, 1));
        assertEquals(List.of(0, 1), from);
        assertEquals(Map.of(), facts.targetAttributes());
        assertEquals(List.of(
                new CustomerRecordPanelReads.DirectionFacts("outgoing", "person", "ok", rows, null),
                new CustomerRecordPanelReads.DirectionFacts("incoming", "person", "refused", null, "Incoming refused")), facts.directions());
    }

    @Test
    void customerRelationshipReturnsTheOwnersCenterRefusalBeforeAnyDirectionRead() {
        var data = mock(DataService.class);
        var dsl = mock(DslService.class);
        var permission = new UserDataPermission();
        var captured = subject.withLiveDataPermission(permission);
        var owner = new CustomerRecordPanelReads(panel, data, dsl).customerRelationshipNeighbors();
        String lang = LocaleContextHolder.getLocale().toLanguageTag();
        when(authorization.decide(captured, new Management("ontology-model.read"))).thenReturn(new Decision(true, null, null));
        when(model.attributes("person", "d1", lang)).thenReturn(List.of(attribute("person", "id", true, false)));
        var refusal = JSONObject.of("success", false, "code", "DATA_PERMISSION_DENIED", "message", "Hidden center");
        when(data.queryInfoByNode(JSONObject.of("class", "person", "id", "person:p1"), lang, permission, "d1")).thenReturn(refusal);
        var facts = (CustomerRecordPanelReads.NeighborFacts) owner.handler().read(captured, neighbors("friends", "person", "p1", 1, 0));
        assertEquals(refusal, facts.anchor().answer());
        assertEquals(List.of(), facts.directions());
        verifyNoInteractions(dsl);
    }

    @Test
    void scopedCustomerRelationshipReadsOnlyWhenBothEndpointsAndCenterAreInScope() {
        var data = mock(DataService.class);
        var dsl = mock(DslService.class);
        var permission = new UserDataPermission();
        var captured = subject.withLiveDataPermission(permission);
        var owner = new CustomerRecordPanelReads(panel, data, dsl).customerRelationshipNeighbors();
        var handler = (WorkbenchPanelRead.CallerScopedHandler) owner.handler();
        String lang = LocaleContextHolder.getLocale().toLanguageTag();
        when(authorization.decide(captured, new Management("ontology-model.read"))).thenReturn(new Decision(true, null, null));
        when(model.attributes("org", "d1", lang)).thenReturn(List.of(attribute("org", "id", true, false)));
        when(model.attributes("person", "d1", lang)).thenReturn(List.of(attribute("person", "id", true, false)));
        when(model.relationships("org", "d1", lang)).thenReturn(List.of(
                new RelationshipView("staff", "person", "org", "Staff", "team", "id", "Person", "Organization")));
        when(data.queryInfoByNode(JSONObject.of("class", "org", "id", "org:o1"), lang, permission, "d1"))
                .thenReturn(centerRecord());
        var rows = JSONArray.of(JSONObject.of("id", "p1"));
        when(dsl.executeV1ForDomain(any(), eq(permission), eq("d1")))
                .thenReturn(JSONObject.of("data", JSONArray.of(JSONObject.of("answer", rows))));
        var params = neighbors("staff", "org", "o1", 1, 0);
        long expiry = System.currentTimeMillis() + 60_000;
        var both = new ExecutionTarget(null, null, List.of("org", "person"), expiry, "u1", "initiator");
        var centerOnly = new ExecutionTarget(null, null, List.of("org"), expiry, "u1", "initiator");
        var outside = new ExecutionTarget(null, null, List.of("person"), expiry, "u1", "initiator");

        var matching = (CustomerRecordPanelReads.NeighborFacts) handler.read(captured, params, both);
        assertEquals(List.of(new CustomerRecordPanelReads.DirectionFacts("incoming", "person", "ok", rows, null)), matching.directions());
        var hidden = (CustomerRecordPanelReads.NeighborFacts) handler.read(captured, params, centerOnly);
        assertNull(hidden.label());
        assertEquals(List.of(), hidden.directions());
        assertEquals(Map.of(), hidden.targetAttributes());
        assertEquals(Map.of(), hidden.typeLabels());
        assertEquals(403, assertThrows(ResponseStatusException.class, () -> handler.read(captured, params, outside))
                .getStatusCode().value());
        verify(model, times(2)).attributes("org", "d1", lang);
        verify(model).attributes("person", "d1", lang);
        verify(data, times(2)).queryInfoByNode(JSONObject.of("class", "org", "id", "org:o1"), lang, permission, "d1");
        verify(dsl).executeV1ForDomain(any(), eq(permission), eq("d1"));
        verify(dsl, never()).executeV1(any(), any(), any());
    }

    @Test
    void customerObjectRegistrationsUseExistingOwnersWithinScopeAndRejectOutsideIt() {
        var data = mock(DataService.class);
        var dsl = mock(DslService.class);
        var permission = new UserDataPermission();
        var captured = subject.withLiveDataPermission(permission);
        var owner = new CustomerRecordPanelReads(panel, data, dsl);
        String lang = LocaleContextHolder.getLocale().toLanguageTag();
        var managementRead = new Management("ontology-model.read");
        when(authorization.decide(captured, managementRead)).thenReturn(new Decision(true, null, null));
        when(authorization.decide(subject, managementRead)).thenReturn(new Decision(true, null, null));
        var attributes = List.of(attribute("org", "id", true, false));
        var type = mock(ObjectTypeView.class);
        var center = centerRecord();
        var page = JSONObject.of("success", true, "data", JSONArray.of(), "total_count", 0);
        when(model.attributes("org", "d1", lang)).thenReturn(attributes);
        when(model.objectType("org", "d1", lang)).thenReturn(type);
        var pageParams = Map.<String, Object>of("classname", "org", "pagenum", 1, "pagecount", 20);
        var recordParams = Map.<String, Object>of("className", "org", "primaryKey", "o1");
        when(data.getWholeClassDataByPage(new JSONObject(pageParams), lang, permission, "d1")).thenReturn(page);
        when(data.queryInfoByNode(JSONObject.of("class", "org", "id", "org:o1"), lang, permission, "d1")).thenReturn(center);
        var record = new CustomerRecordPanelReads.Facts(attributes, center);
        var rows = new CustomerRecordPanelReads.Facts(attributes, page);
        record Read(WorkbenchPanelRead registration, Map<String, Object> params, Object expected) {}
        var reads = List.of(
                new Read(owner.customerQuery(), pageParams, rows),
                new Read(owner.customerRecord(), recordParams, record),
                new Read(owner.customerForm(), recordParams, record),
                new Read(owner.customerCreateForm(), Map.of("className", "org"), Map.of("attributes", attributes)),
                new Read(owner.objectTypeInstances(), pageParams, rows),
                new Read(owner.objectTypeInstanceRecord(), recordParams, Map.of("record", record, "type", type)));
        long expiry = System.currentTimeMillis() + 60_000;
        var allowed = new ExecutionTarget(null, null, List.of("org"), expiry, "u1", "initiator");
        var outside = new ExecutionTarget(null, null, List.of("person"), expiry, "u1", "initiator");
        for (var read : reads) {
            var registration = read.registration();
            var handler = (WorkbenchPanelRead.CallerScopedHandler) registration.handler();
            assertEquals(!"createForm".equals(registration.name()), registration.requiresLiveData());
            var viewer = registration.requiresLiveData() ? captured : subject;
            assertEquals(read.expected(), handler.read(viewer, read.params(), allowed), registration.name());
            assertEquals(403, assertThrows(ResponseStatusException.class,
                    () -> handler.read(viewer, read.params(), outside)).getStatusCode().value(), registration.name());
        }
        verify(model, times(6)).attributes("org", "d1", lang);
        verify(model).objectType("org", "d1", lang);
        verify(data, times(2)).getWholeClassDataByPage(new JSONObject(pageParams), lang, permission, "d1");
        verify(data, times(3)).queryInfoByNode(JSONObject.of("class", "org", "id", "org:o1"), lang, permission, "d1");
        verifyNoInteractions(dsl);
    }

    @Test
    void favoriteRecordsUseTheScopedRecordOwnerForEachObjectAndKeepUnavailableSlots() {
        var data = mock(DataService.class);
        var permission = new UserDataPermission();
        var captured = subject.withLiveDataPermission(permission);
        var owner = new CustomerRecordPanelReads(panel, data, mock(DslService.class)).customerFavoriteRecords();
        var handler = (WorkbenchPanelRead.CallerScopedHandler) owner.handler();
        String lang = LocaleContextHolder.getLocale().toLanguageTag();
        var attributes = List.of(attribute("org", "id", true, false));
        when(authorization.decide(captured, new Management("ontology-model.read"))).thenReturn(new Decision(true, null, null));
        when(model.attributes("org", "d1", lang)).thenReturn(attributes);
        when(model.attributes("removed", "d1", lang))
                .thenThrow(OntologyModelException.notFound("OBJECT_TYPE_NOT_FOUND", "Class removed"));
        var center = centerRecord();
        var hidden = JSONObject.of("success", false, "code", "DATA_PERMISSION_DENIED", "message", "Hidden");
        when(data.queryInfoByNode(JSONObject.of("class", "org", "id", "org:o1"), lang, permission, "d1")).thenReturn(center);
        when(data.queryInfoByNode(JSONObject.of("class", "org", "id", "org:hidden"), lang, permission, "d1")).thenReturn(hidden);
        var target = new ExecutionTarget(null, null, List.of("org", "removed"),
                System.currentTimeMillis() + 60_000, "u1", "initiator");
        var objects = List.of(Map.of("className", "org", "primaryKey", "o1"),
                Map.of("className", "person", "primaryKey", "p1"),
                Map.of("className", "org", "primaryKey", "hidden"),
                Map.of("className", "removed", "primaryKey", "r1"));
        var results = (List<?>) handler.read(captured, Map.of("objects", objects), target);

        assertTrue(owner.requiresLiveData());
        assertEquals(4, results.size());
        assertEquals(new CustomerRecordPanelReads.Facts(attributes, center), results.get(0));
        assertNull(results.get(1));
        assertEquals(new CustomerRecordPanelReads.Facts(attributes, hidden), results.get(2));
        assertNull(results.get(3));
        verify(model, never()).attributes("person", "d1", lang);
        verify(data, times(2)).queryInfoByNode(any(), eq(lang), eq(permission), eq("d1"));
    }

    private static Map<String, Object> neighbors(String relation, String className, String key, int limit, int offset) {
        return Map.of("relationshipId", relation, "node", Map.of("className", className, "primaryKey", key),
                "limit", limit, "offset", offset);
    }

    private static AttributeView attribute(String className, String name, boolean primaryKey, boolean businessKey) {
        return new AttributeView(className, name, name, "varchar", "", true, businessKey, primaryKey);
    }

    private static JSONObject centerRecord() {
        return JSONObject.of("success", true, "data",
                JSONObject.of("classDef", JSONObject.of("unneeded", true), "data", JSONObject.of("name", "Center")));
    }

    private static JSONObject firstStep(JSONObject dsl) {
        return dsl.getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
    }

    @Test
    void attributeListUsesVerifiedDomainAndReturnsViewsWithLocalizedLabels() {
        when(authorization.decide(subject, new Management("ontology-model.read")))
                .thenReturn(new Decision(true, null, null));
        var views = List.of(new AttributeView("Device", "id", "ID", "varchar", "", true, false, true));
        var classLabels = Map.of("Device", "Pump model");
        var fields = Map.of("name", "Name localized");
        when(model.attributeRows("Device", "d1", "de")).thenReturn(new AttributeRows(views, classLabels));
        when(model.fieldLabels("de")).thenReturn(new FieldLabels(Map.of(), fields, Map.of()));

        LocaleContextHolder.setLocale(Locale.GERMAN);
        try {
            var response = panel.attributeList().handler().read(subject, Map.of("className", "Device", "lang", "en"));
            assertEquals(Map.of("views", views, "classLabels", classLabels, "fieldLabels", fields), response);
        } finally {
            LocaleContextHolder.resetLocaleContext();
        }
    }
}

package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dao.KnowledgeEntity;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.KnowledgeService;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.CredentialLimit;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Decision;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Management;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.AuthorizationService.VerifiedIdentity;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import io.ontomato.dataengine.service.impl.AdminServiceImpl;
import io.ontomato.dataengine.util.SpringBeanUtil;
import jakarta.servlet.ServletException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

class AdminCountBoundaryTest {
    private final AdminService admin = mock(AdminService.class);
    private final KnowledgeService knowledge = mock(KnowledgeService.class);
    private MockMvc mvc;
    private AdminController controller;

    @BeforeEach
    void wire() {
        var user = mock(User.class);
        when(user.getDomainId()).thenReturn("current-domain");
        var identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(user);
        var context = new GenericApplicationContext();
        context.registerBean(IdentityService.class, () -> identity);
        context.refresh();
        new SpringBeanUtil().setApplicationContext(context);

        controller = new AdminController();
        ReflectionTestUtils.setField(controller, "adminService", admin);
        ReflectionTestUtils.setField(controller, "knowledgeService", knowledge);
        mvc = MockMvcBuilders.standaloneSetup(controller)
                .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    }

    @Test
    void countsUseTheAuthenticatedDomainWithoutLoadingDefinitionsOrEntries() throws Exception {
        when(admin.countOntologyMetadata("current-domain"))
                .thenReturn(Map.of("objectTypes", 2, "attributes", 4, "relationships", 1));
        when(knowledge.countBusinessKnowledge("current-domain")).thenReturn(3);
        var payload = "{\"countOnly\":true,\"domainId\":\"other-domain\"}";

        mvc.perform(post("/admin/getMetas").contentType(MediaType.APPLICATION_JSON).content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.objectTypes").value(2))
                .andExpect(jsonPath("$.data.attributes").value(4))
                .andExpect(jsonPath("$.data.relationships").value(1));
        mvc.perform(post("/admin/getBussinessKnowledge").contentType(MediaType.APPLICATION_JSON).content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.total").value(3));

        verify(admin, never()).getJSONRule("current-domain");
        verify(knowledge, never()).getBussinessKnowledge("current-domain");
    }

    @Test
    void panelKnowledgeCountRequiresTheKnowledgeReadOperationAndUsesTheVerifiedDomain() {
        var authorization = mock(AuthorizationService.class);
        var subject = new SubjectContext(new VerifiedIdentity("current-domain", "reader", CredentialLimit.UNRESTRICTED),
                null, Map.of(), Set.of(), Set.of());
        var operation = new Management("business-knowledge.read");
        var read = controller.businessKnowledgePanelCount(new ManagementRequestAccess(null, authorization, null)).handler();
        when(authorization.decide(subject, operation)).thenReturn(new Decision(false, "MANAGEMENT_FORBIDDEN", "denied"));
        var params = Map.<String, Object>of("domainId", "other-domain");
        assertEquals(403, assertThrows(ResponseStatusException.class, () -> read.read(subject, params)).getStatusCode().value());
        verifyNoInteractions(knowledge);

        when(authorization.decide(subject, operation)).thenReturn(new Decision(true, null, null));
        when(knowledge.countBusinessKnowledge("current-domain")).thenReturn(3);
        assertEquals(Map.of("rows", List.of(), "total", 3), read.read(subject, params));
    }

    @Test
    void modelCentersUseTheVerifiedDomainAndRequireOntologyModelRead() {
        var authorization = mock(AuthorizationService.class);
        var subject = new SubjectContext(new VerifiedIdentity("current-domain", "reader", CredentialLimit.UNRESTRICTED),
                null, Map.of(), Set.of(), Set.of());
        var operation = new Management(OntologyModelController.Operations.READ);
        var read = controller.ontologyModelNeighbors(new ManagementRequestAccess(null, authorization, null)).handler();
        var params = Map.<String, Object>of("className", "platform:ObjectType", "primaryKey", "Order",
                "domainId", "outside", "relations", List.of());
        when(authorization.decide(subject, operation)).thenReturn(new Decision(false, "MANAGEMENT_FORBIDDEN", "denied"));
        assertEquals(403, assertThrows(ResponseStatusException.class, () -> read.read(subject, params)).getStatusCode().value());
        verifyNoInteractions(admin);

        when(authorization.decide(subject, operation)).thenReturn(new Decision(true, null, null));
        when(admin.getJSONRule("current-domain")).thenReturn(modelRule());
        var center = ((AdminController.ModelNeighborFacts) read.read(subject, params)).center();
        assertEquals(List.of(Map.of("className", "Order", "classDesc", "Orders")), center.classDef());
        assertEquals(List.of(), center.relationDef());
        var missing = new AdminController.ModelNeighborFacts(new AdminController.ModelScopeFacts(List.of(), List.of()), Map.of());
        assertEquals(missing, read.read(subject,
                Map.of("className", "platform:Attribute", "primaryKey", "bad-key", "relations", List.of())));
        assertEquals(missing, read.read(subject,
                Map.of("className", "platform:ObjectType", "primaryKey", " ", "relations", List.of())));
    }

    @Test
    void modelEdgesReadOneAuthorizedRuleForTheCenterAndAllRequestedRelations() {
        var authorization = mock(AuthorizationService.class);
        var subject = new SubjectContext(new VerifiedIdentity("current-domain", "reader", CredentialLimit.UNRESTRICTED),
                null, Map.of(), Set.of(), Set.of());
        var operation = new Management(OntologyModelController.Operations.READ);
        var management = new ManagementRequestAccess(null, authorization, null);
        when(authorization.decide(subject, operation)).thenReturn(new Decision(true, null, null));
        when(admin.getJSONRule("current-domain")).thenReturn(modelRule());

        String object = "platform:ObjectType", attribute = "platform:Attribute", relationship = "platform:Relationship";
        String hasAttribute = "object-type.has-attribute", from = "relationship.from-object-type", to = "relationship.to-object-type";
        var read = controller.ontologyModelNeighbors(management).handler();
        var order = (AdminController.ModelNeighborFacts) read.read(subject, Map.of(
                "className", object, "primaryKey", "Order", "domainId", "outside",
                "relations", List.of(modelRelation(hasAttribute, "outgoing"),
                        modelRelation(from, "incoming"), modelRelation(to, "incoming"))));
        verify(authorization).decide(subject, operation);
        verify(admin).getJSONRule("current-domain");
        assertEquals(List.of(Map.of("className", "Order", "classDesc", "Orders")), order.center().classDef());
        assertEquals(List.of(Map.of("className", "Order", "classDesc", "Orders",
                "attrs", List.of(Map.of("name", "code", "showName", "Code"), Map.of("name", "amount")))),
                order.relations().get(hasAttribute).classDef());
        assertEquals(Set.of("stored-key", "DANGLING"), ((Map<?, ?>) order.relations().get(from).relationDef()).keySet());
        assertEquals(Set.of("RETURNS"), ((Map<?, ?>) order.relations().get(to).relationDef()).keySet());

        var code = (AdminController.ModelNeighborFacts) read.read(subject, Map.of(
                "className", attribute, "primaryKey", "[\"Order\",\"code\"]", "attributeKey", List.of("Order", "code"),
                "relations", List.of(modelRelation(hasAttribute, "incoming"))));
        assertEquals(List.of(Map.of("className", "Order", "classDesc", "Orders",
                "attrs", List.of(Map.of("name", "code", "showName", "Code")))),
                code.relations().get(hasAttribute).classDef());

        var ships = (AdminController.ModelNeighborFacts) read.read(subject, Map.of(
                "className", relationship, "primaryKey", "SHIPS",
                "relations", List.of(modelRelation(from, "outgoing"), modelRelation(to, "outgoing"))));
        assertEquals(List.of(Map.of("className", "Order", "classDesc", "Orders")), ships.relations().get(from).classDef());
        assertEquals(List.of(Map.of("className", "Customer", "showName", "Customers")), ships.relations().get(to).classDef());

        var dangling = (AdminController.ModelNeighborFacts) read.read(subject, Map.of(
                "className", relationship, "primaryKey", "DANGLING", "relations", List.of(modelRelation(to, "outgoing"))));
        assertEquals(List.of(), dangling.relations().get(to).classDef());
        assertEquals(Set.of("DANGLING"), ((Map<?, ?>) dangling.relations().get(to).relationDef()).keySet());
    }

    private static Map<String, String> modelRelation(String kind, String direction) {
        return Map.of("kind", kind, "direction", direction);
    }

    private static Map<String, Object> modelRule() {
        return Map.of("classDef", List.of(
                Map.of("className", "Order", "classDesc", "Orders", "attrs", List.of(
                        Map.of("name", "code", "showName", "Code", "type", "STRING"), Map.of("name", "amount"))),
                Map.of("className", "Customer", "showName", "Customers"),
                Map.of("className", "Unrelated", "attrs", List.of(Map.of("name", "secret")))),
                "relationship_rule", Map.of(
                        "stored-key", Map.of("relationship", "\u00a0SHIPS\uFEFF", "relationShowName", "Ships",
                                "fromclass", " Order ", "toclass", "Customer"),
                        "RETURNS", Map.of("fromclass", "Customer", "toclass", "Order"),
                        "DANGLING", Map.of("fromclass", "Order", "toclass", "Missing"),
                        "UNRELATED", Map.of("fromclass", "Unrelated", "toclass", "Unrelated")));
    }

    @Test
    void absentOrFalseCountOnlyStillReturnsTheOriginalData() throws Exception {
        when(admin.getJSONRule("current-domain")).thenReturn(Map.of("classDef", List.of(Map.of("className", "Room"))));
        var entry = new KnowledgeEntity();
        entry.setKnowledgeID("k1");
        when(knowledge.getBussinessKnowledge("current-domain")).thenReturn(Map.of("k1", entry));

        mvc.perform(post("/admin/getMetas").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.classDef[0].className").value("Room"));
        mvc.perform(post("/admin/getBussinessKnowledge").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"countOnly\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.k1.knowledgeID").value("k1"));
    }

    @Test
    void aMissingOntologyRuleFailsTheSameWayInBothOwnerReads() {
        var dao = mock(JSONRuleDao.class);
        when(dao.query("current-domain")).thenReturn(null);
        when(dao.countMetadata("current-domain")).thenReturn(null);
        var service = new AdminServiceImpl();
        ReflectionTestUtils.setField(service, "jsonRuleDao", dao);

        var original = assertThrows(IllegalStateException.class, () -> service.getJSONRule("current-domain"));
        when(admin.countOntologyMetadata("current-domain")).thenAnswer(call -> service.countOntologyMetadata("current-domain"));
        var failure = assertThrows(ServletException.class, () -> mvc.perform(post("/admin/getMetas")
                .contentType(MediaType.APPLICATION_JSON).content("{\"countOnly\":true}")));
        assertEquals(original.getClass(), failure.getCause().getClass());
        assertEquals(original.getMessage(), failure.getCause().getMessage());
    }

    @Test
    void knowledgeCountDoesNotCatchStorageFailures() {
        var storageFailure = new IllegalStateException("Storage failed");
        when(knowledge.countBusinessKnowledge("current-domain")).thenThrow(storageFailure);

        var failure = assertThrows(ServletException.class, () -> mvc.perform(post("/admin/getBussinessKnowledge")
                .contentType(MediaType.APPLICATION_JSON).content("{\"countOnly\":true}")));
        assertSame(storageFailure, failure.getCause());
    }
}

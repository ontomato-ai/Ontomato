package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class OntologyModelSearchFactsTest {
    @Test
    void readsTheOriginalMetadataOwnerAndProjectsOnlyTheRequestedDirectoryFields() {
        var admin = mock(AdminService.class);
        var management = mock(ManagementRequestAccess.class);
        var subject = mock(SubjectContext.class);
        var controller = new AdminController();
        ReflectionTestUtils.setField(controller, "adminService", admin);
        when(subject.identity()).thenReturn(new VerifiedIdentity("tenant", "reader", CredentialLimit.UNRESTRICTED));
        when(admin.getJSONRule("tenant")).thenReturn(Map.of(
            "classDef", List.of(Map.of("className", "Order", "classDesc", "Orders", "unrelated", "hidden",
                "attrs", List.of(Map.of("name", "amount", "showName", "Amount", "enable", false)))),
            "relationship_rule", Map.of("contains", Map.of("relationShowName", "Contains",
                "fromclass", "Order", "toclass", "Item", "privateMetadata", "hidden"))));
        var handler = controller.ontologyModelInstanceDirectory(management).handler();

        assertEquals(Map.of("classDef", List.of(Map.of("className", "Order", "classDesc", "Orders"))),
            handler.read(subject, Map.of("type", "platform:ObjectType")));
        assertEquals(Map.of("classDef", List.of(Map.of("className", "Order",
            "attrs", List.of(Map.of("name", "amount", "showName", "Amount"))))),
            handler.read(subject, Map.of("type", "platform:Attribute")));
        assertEquals(Map.of("relationDef", Map.of("contains",
            Map.of("relationShowName", "Contains", "fromclass", "Order", "toclass", "Item"))),
            handler.read(subject, Map.of("type", "platform:Relationship")));
        var order = inOrder(management, admin);
        for (int i = 0; i < 3; i++) {
            order.verify(management).require(subject, OntologyModelController.Operations.READ);
            order.verify(admin).getJSONRule("tenant");
        }
    }
}

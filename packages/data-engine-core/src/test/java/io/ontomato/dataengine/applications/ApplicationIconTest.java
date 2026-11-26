package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.ProductPrincipalLookup;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.AuthorizationSubjects;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;
import java.util.Map;
import java.util.Set;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

class ApplicationIconTest {
    @Test void metadataUpdatesRequireApplicationMaintenanceAndKeepThePublishedRelease() {
        var db = mock(JdbcTemplate.class);
        var tx = mock(TransactionTemplate.class);
        doAnswer(call -> {
            call.<Consumer<TransactionStatus>>getArgument(0).accept(null);
            return null;
        }).when(tx).executeWithoutResult(any());
        var access = mock(ApplicationAccess.class);
        var authorization = EntryAuthorizationFixture.allowEntries();
        var panels = mock(PanelResources.class);
        var user = mock(User.class);
        when(user.getDomainId()).thenReturn("domain");
        var catalog = spy(new ApplicationCatalog(db, tx, access, "{}", panels, mock(ProductPrincipalLookup.class), authorization));
        var app = JSONObject.of("id", "app-example", "domainId", "domain", "releaseId", "release", "icon", "ontology");
        doReturn(app).when(catalog).require("app-example");

        assertThrows(ResponseStatusException.class, () -> catalog.updateIcon("app-example", "users", user));
        verify(db, never()).update(anyString(), any(Object[].class));
        verifyNoInteractions(panels);

        EntryAuthorizationFixture.allowEdit(authorization, user, app);
        catalog.updateIcon("app-example", "ontology", user);
        verifyNoInteractions(panels);
        catalog.updateIcon("app-example", "users", user);
        verify(panels).requireCurrent("domain", null, List.of(), null, null, "users", null);
        verify(db).update("UPDATE sys_application SET icon=?,updated_at=now() WHERE id=?", "users", "app-example");
        assertEquals("release", app.getString("releaseId"));

        doThrow(ApplicationCatalog.bad("Invalid application icon")).when(panels)
            .requireCurrent("domain", null, List.of(), null, null, "https://external/icon.svg", null);
        assertThrows(ResponseStatusException.class, () -> catalog.updateIcon("app-example", "https://external/icon.svg", user));
        verify(db, never()).update("UPDATE sys_application SET icon=?,updated_at=now() WHERE id=?", "https://external/icon.svg", "app-example");
    }

    @Test void registeredApplicationEditUsesOwnershipOrExplicitObjectPolicy() {
        var subjects = mock(AuthorizationSubjects.class);
        var store = mock(AuthorizationStore.class);
        var grants = mock(ProductPrincipalLookup.class);
        var authorization = new AuthorizationService(subjects, store, null, null, null);
        var catalog = spy(new ApplicationCatalog(mock(JdbcTemplate.class), mock(TransactionTemplate.class),
            mock(ApplicationAccess.class), "{}", mock(PanelResources.class), grants, authorization));
        var app = JSONObject.of("id", "app-example", "domainId", "domain", "kind", "hosted",
            "ownerUserId", "author", "coauthorIds", List.of("coauthor"), "groups", List.of(),
            "panelUses", List.of(), "pageSkills", List.of(), "panelSettings", new JSONObject(),
            "entry", JSONObject.of("path", "/apps/app-example/", "entryKey", "main"));
        doReturn(List.of(app)).when(catalog).all();
        var target = new ObjectTarget("domain", Kind.APPLICATION, "app-example");
        var policy = new PolicyRef("editors", "policy", PolicyKind.OBJECT);
        when(subjects.resolveRoles(eq("domain"), anyString())).thenAnswer(call -> {
            String user = call.getArgument(1);
            return new RoleResolution(user.equals("editor") ? Set.of("editors") : Set.of(), Set.of(),
                List.of(), Set.of(), Map.of(), user.equals("admin"));
        });
        when(store.policies("domain", Set.of("editors"))).thenReturn(List.of(policy));
        when(store.objectGrants(target, Verb.EDIT, Set.of("policy")))
            .thenReturn(List.of(new ObjectGrant("policy", target, Verb.EDIT, null)));
        when(subjects.entryEntitlement(new ObjectTarget("domain", Kind.ENTRY, "app-example/main"))).thenReturn(true);
        when(subjects.objectEntitlement("reader", target, Verb.USE)).thenReturn(true);

        for (String id : List.of("author", "coauthor", "editor")) {
            var user = new QueryAccessService.GrantUser(id, "domain");
            var record = catalog.catalogueRecord("app-example", user);
            assertTrue(record.getBooleanValue("canMaintain"));
            assertTrue(catalog.legacyMaintenance("app-example", user));
        }
        for (String id : List.of("reader", "admin")) {
            var user = new QueryAccessService.GrantUser(id, "domain");
            var record = catalog.catalogueRecord("app-example", user);
            assertFalse(record.getBooleanValue("canMaintain"));
            assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
                () -> catalog.legacyMaintenance("app-example", user)).getStatusCode());
        }
        var foreignAuthor = new QueryAccessService.GrantUser("author", "another");
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
            () -> catalog.legacyMaintenance("app-example", foreignAuthor)).getStatusCode());
        app.remove("ownerUserId");
        assertTrue(catalog.legacyMaintenance("app-example", new QueryAccessService.GrantUser("editor", "domain")));
        assertThrows(ResponseStatusException.class,
            () -> catalog.legacyMaintenance("app-example", new QueryAccessService.GrantUser("author", "domain")));
    }
}

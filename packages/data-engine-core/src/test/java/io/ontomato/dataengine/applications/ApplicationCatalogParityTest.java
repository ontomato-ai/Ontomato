package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.IdentityPrincipalDirectory;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.CredentialLimit;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Entry;
import io.ontomato.dataengine.service.authorization.AuthorizationService.ObjectAccess;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.AuthorizationService.VerifiedIdentity;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.AuthorizationSubjects;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.DefinitionState;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Kind;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.ObjectTarget;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.OwnerFacts;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.RoleResolution;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

class ApplicationCatalogParityTest {
    @Test
    void panelReverseReadsSelectOnlyTheRequestedPanelInTheVerifiedDomain() {
        var use = new ApplicationPanelUse("one", "one", "target", "/applications/local/one",
            null, null, null, null, null, null, null, null);
        var other = new ApplicationPanelUse("two", "two", "different", "/applications/local/two",
            null, null, null, null, null, null, null, null);
        var local = domainApp("local", "domain-a", "alice", "Local");
        local.put("panelUses", List.of(use, other));
        var foreign = domainApp("foreign", "domain-b", "bob", "Foreign");
        foreign.put("panelUses", List.of(use));
        var catalog = spy(new ApplicationCatalog(mock(JdbcTemplate.class), mock(TransactionTemplate.class), mock(ApplicationAccess.class),
            "{}", mock(PanelResources.class), mock(IdentityPrincipalDirectory.class), EntryAuthorizationFixture.allowEntries()));
        doReturn(List.of(local, foreign)).when(catalog).all();
        var controller = new ApplicationController(catalog, null, null);
        var subject = new SubjectContext(new VerifiedIdentity("domain-a", "alice", CredentialLimit.UNRESTRICTED),
                new RoleResolution(Set.of(), Set.of(), List.of(), Set.of(), Map.of(), false, false), Map.of(), Set.of(), Set.of());
        var expected = List.of(new ApplicationCatalog.PanelUseLocation("local", Map.of("en", "Local"), "one", "/applications/local/one"));
        for (var registration : List.of(controller.productPanelUsedByRows(), controller.productPanelReferenceGraph())) {
            assertEquals(expected, registration.handler().read(subject, Map.of("primaryKey", "target", "domainId", "domain-b")));
        }
    }

    @Test
    void catalogueSupportsNumericPageAndMineSharedScopes() {
        var access = mock(ApplicationAccess.class);
        var authorization = EntryAuthorizationFixture.allowEntries();
        var grants = mock(IdentityPrincipalDirectory.class);
        var user = new QueryAccessService.GrantUser("alice", "domain-a");

        var mineApp = domainApp("app-mine", "domain-a", "alice", "Alpha Mine");
        var sharedApp = domainApp("app-shared", "domain-a", "bob", "Beta Shared");
        var builtinApp = builtinApp("builtin-ops", "Gamma Builtin");

        EntryAuthorizationFixture.allowEdit(authorization, user, mineApp);
        when(grants.principalNames(any(), any())).thenReturn(Map.of("alice", "Alice", "bob", "Bob"));

        var catalog = spy(new ApplicationCatalog(mock(JdbcTemplate.class), mock(TransactionTemplate.class), access,
            "{}", mock(PanelResources.class), grants, authorization));
        doReturn(List.of(mineApp, sharedApp, builtinApp)).when(catalog).loadApplications(true);

        var allPage1 = catalog.catalogue(user, "", "visible", null, 1, 2, "id", Locale.ENGLISH);
        assertEquals(3, allPage1.getIntValue("total"));
        assertEquals(2, allPage1.getJSONArray("rows").size());
        assertEquals("app-mine", allPage1.getJSONArray("rows").getJSONObject(0).getString("id"));
        assertNotNull(allPage1.getString("nextCursor"));

        var allPage2 = catalog.catalogue(user, "", "visible", null, 2, 2, "id", Locale.ENGLISH);
        assertEquals(3, allPage2.getIntValue("total"));
        assertEquals(1, allPage2.getJSONArray("rows").size());
        assertEquals("builtin-ops", allPage2.getJSONArray("rows").getJSONObject(0).getString("id"));

        var mineOnly = catalog.catalogue(user, "", "mine", null, 1, 20, "id", Locale.ENGLISH);
        assertEquals(1, mineOnly.getIntValue("total"));
        assertEquals("app-mine", mineOnly.getJSONArray("rows").getJSONObject(0).getString("id"));

        var sharedOnly = catalog.catalogue(user, "", "shared", null, 1, 20, "id", Locale.ENGLISH);
        assertEquals(2, sharedOnly.getIntValue("total"));
        var sharedIds = sharedOnly.getJSONArray("rows").stream()
            .map(row -> ((JSONObject) row).getString("id")).toList();
        assertEquals(List.of("app-shared", "builtin-ops"), sharedIds);

        assertThrows(ResponseStatusException.class,
            () -> catalog.catalogue(user, "", "visible", null, 0, 20, "id", Locale.ENGLISH));
    }

    @Test
    void registeredCatalogueUsesTheOssJavaOwnerAndKeepsTheWorkbenchPlacementIdentity() {
        var subjects = mock(AuthorizationSubjects.class);
        var store = mock(AuthorizationStore.class);
        when(subjects.resolveRoles("1", "system"))
                .thenReturn(new RoleResolution(Set.of(), Set.of(), List.of(), Set.of(), Map.of(), false, false));
        when(subjects.entryEntitlement(any())).thenReturn(true);
        var authorization = spy(new AuthorizationService(subjects, store, null, null, null));

        var mine = domainApp("app-java-owner", "1", "admin", "Java-owned app");
        mine.getJSONObject("entry").put("renderer", "panels");
        var shared = domainApp("app-workbench-owner", "1", "system", "Workbench-owned app");
        var catalog = spy(new ApplicationCatalog(mock(JdbcTemplate.class), mock(TransactionTemplate.class),
            mock(ApplicationAccess.class), "{}", mock(PanelResources.class), mock(IdentityPrincipalDirectory.class), authorization));
        doReturn(List.of(mine, shared)).when(catalog).loadApplications(true);

        var subject = authorization.resolveSubject(new VerifiedIdentity("1", "system", CredentialLimit.UNRESTRICTED))
                .withJavaUserId("admin");
        var handler = new ApplicationController(catalog, null, null).applicationPanelQuery().handler();
        var mines = (JSONObject) handler.read(subject, Map.of("scope", "mine"));
        assertEquals(1, mines.getIntValue("total"));
        var row = mines.getJSONArray("rows").getJSONObject(0);
        assertEquals("app-java-owner", row.getString("id"));
        assertTrue(row.getBooleanValue("canMaintain"));
        assertTrue(row.getBooleanValue("canEditEntries"));

        var others = (JSONObject) handler.read(subject, Map.of("scope", "shared"));
        assertEquals(1, others.getIntValue("total"));
        var sharedRow = others.getJSONArray("rows").getJSONObject(0);
        assertEquals("app-workbench-owner", sharedRow.getString("id"));
        assertFalse(sharedRow.getBooleanValue("canMaintain"));

        var entrySubjects = ArgumentCaptor.forClass(SubjectContext.class);
        verify(authorization, atLeastOnce()).decide(entrySubjects.capture(), any(Entry.class));
        for (var entrySubject : entrySubjects.getAllValues()) {
            assertEquals("admin", entrySubject.identity().userId());
            assertSame(subject.identity().limit(), entrySubject.identity().limit());
            assertSame(subject.roles(), entrySubject.roles());
            assertSame(subject.policyRefsByRole(), entrySubject.policyRefsByRole());
        }

        var panel = new ObjectTarget("1", Kind.PANEL, "placement");
        assertTrue(authorization.decide(subject, new ObjectAccess(panel, Verb.USE,
                new OwnerFacts("system", DefinitionState.DRAFT))).allowed());
        assertFalse(authorization.decide(subject, new ObjectAccess(panel, Verb.USE,
                new OwnerFacts("admin", DefinitionState.DRAFT))).allowed());
        verify(subjects).resolveRoles(any(), any());
    }

    @Test
    void registeredPartialEntryTableKeepsSavedEntriesAndUsesTheJavaOwner() {
        var subjects = mock(AuthorizationSubjects.class);
        when(subjects.resolveRoles("1", "system"))
                .thenReturn(new RoleResolution(Set.of(), Set.of(), List.of(), Set.of(), Map.of(), false, false));
        var authorization = new AuthorizationService(subjects, mock(AuthorizationStore.class), null, null, null);
        var app = domainApp("app-java-owner", "1", "admin", "Java-owned app");
        app.getJSONObject("entry").put("renderer", "panels");
        app.put("panelUses", List.of(new ApplicationPanelUse("main", "app-java-owner:main", "panel-main",
            "/applications/app-java-owner/main", new DefaultAgentTarget("id", "agent-main", null), null)));
        var catalog = spy(new ApplicationCatalog(mock(JdbcTemplate.class), mock(TransactionTemplate.class),
            mock(ApplicationAccess.class), "{}", mock(PanelResources.class), mock(IdentityPrincipalDirectory.class), authorization));
        doReturn(List.of(app)).when(catalog).all();

        var subject = authorization.resolveSubject(new VerifiedIdentity("1", "system", CredentialLimit.UNRESTRICTED))
                .withJavaUserId("admin");
        var handler = new ApplicationController(catalog, null, null).applicationPanelForm(new ObjectMapper()).handler();
        var form = (JSONObject) handler.read(subject, Map.of(
            "section", "entries", "target", Map.of("kind", "object", "objectType", "platform:Application", "primaryKey", "app-java-owner"),
            "values", Map.of("entry", Map.of("path", "/applications/app-java-owner/updated", "renderer", "panels")),
            "changedField", "/entry/path", "mergeCurrentValues", true));

        var values = form.getJSONObject("values");
        assertEquals("/applications/app-java-owner/updated", values.getJSONObject("entry").getString("path"));
        assertEquals("agent-main", values.getJSONArray("panelUses").getJSONObject(0).getJSONObject("defaultAgent").getString("id"));
        assertTrue(form.getJSONArray("errors").isEmpty());

        var rowsHandler = new ApplicationController(catalog, null, null).applicationPanelEntryRows().handler();
        var rows = (JSONObject) rowsHandler.read(subject, Map.of("primaryKey", "app-java-owner"));
        assertTrue(rows.getBooleanValue("canEditEntries"));
        assertEquals("main", rows.getJSONArray("panelUses").getJSONObject(0).getString("id"));
        app.getJSONObject("entry").put("renderer", "native");
        var unmanaged = (JSONObject) rowsHandler.read(subject, Map.of("primaryKey", "app-java-owner"));
        assertFalse(unmanaged.getBooleanValue("canEditEntries"));
        verify(subjects).resolveRoles(any(), any());
    }

    @Test
    void productGraphReferencesKeepOnlyCandidatesAdmittedByTheDirectory() {
        var authorization = EntryAuthorizationFixture.entries((actor, key) ->
                key.equals("app-shared/main"));
        var reader = new QueryAccessService.GrantUser("reader", "domain-a");
        var administrator = new QueryAccessService.GrantUser("admin", "domain-a");
        var owned = domainApp("app-owned", "domain-a", "author", "Owned");
        owned.getJSONObject("entry").put("renderer", "panels");
        owned.put("panelSettings", JSONObject.of("framePanelId", "frame-owned"));
        EntryAuthorizationFixture.allowEdit(authorization, reader, owned);
        EntryAuthorizationFixture.allowEdit(authorization, administrator, null);
        var shared = domainApp("app-shared", "domain-a", "other", "Shared");
        shared.getJSONObject("entry").put("renderer", "panels");
        shared.put("panelUses", List.of(
                new ApplicationPanelUse("main", "shared/main", "panel-shared", "/applications/app-shared/main",
                        new DefaultAgentTarget("id", "agent-public", null), Map.of()),
                new ApplicationPanelUse("private", "shared/private", "panel-private", "/applications/app-shared/private",
                        new DefaultAgentTarget("id", "agent-private", null), Map.of())));
        var unrelated = domainApp("app-unrelated", "domain-b", "reader", "Other domain");
        unrelated.put("panelSettings", JSONObject.of("framePanelId", "frame-owned"));
        var names = mock(IdentityPrincipalDirectory.class);
        var catalog = spy(new ApplicationCatalog(mock(JdbcTemplate.class), mock(TransactionTemplate.class),
                mock(ApplicationAccess.class), "{}", mock(PanelResources.class), names, authorization));
        doReturn(List.of(owned, shared, unrelated)).when(catalog).all();
        var subject = authorization.resolveSubject(new VerifiedIdentity("domain-a", "system", CredentialLimit.UNRESTRICTED))
                .withJavaUserId("reader");
        var panels = Set.of("frame-owned", "panel-shared", "panel-private");
        var result = catalog.productGraphCandidates(subject, panels).stream()
            .map(ApplicationCatalog.ProductGraphCandidate::references).toList();
        assertEquals(List.of(
                JSONObject.of("id", "app-owned", "names", JSONObject.of("en", "Owned"),
                        "framePanelId", "frame-owned", "canMaintain", true, "panelIds", List.of(), "defaultAgentIds", List.of()),
                JSONObject.of("id", "app-shared", "names", JSONObject.of("en", "Shared"),
                        "canMaintain", false, "panelIds", List.of("panel-shared"), "defaultAgentIds", List.of("agent-public"))), result);
        verify(authorization).decide(argThat(ctx -> ctx.identity().userId().equals("reader")), argThat(request ->
            request instanceof ObjectAccess access && access.verb() == Verb.EDIT && access.target().id().equals("app-owned")));
        var admin = catalog.productGraphCandidates(subject.withJavaUserId("admin"), panels);
        assertEquals(List.of("app-owned", "app-shared"), admin.stream().map(ApplicationCatalog.ProductGraphCandidate::id).toList());
        assertTrue(admin.stream().allMatch(ApplicationCatalog.ProductGraphCandidate::canMaintain));
        var member = catalog.productGraphCandidates(subject.withJavaUserId("member"), panels);
        assertEquals(List.of("app-shared"), member.stream().map(ApplicationCatalog.ProductGraphCandidate::id).toList());
        assertFalse(member.getFirst().canMaintain());
        assertEquals(List.of(), catalog.productGraphCandidates(subject, Set.of("panel-private")));
        verifyNoInteractions(names);
    }

    @Test
    void copyFormFiltersHiddenEntriesAndExposesPublicThemeOnRecord() {
        var access = mock(ApplicationAccess.class);
        var authorization = EntryAuthorizationFixture.entries((actor, key) ->
            "reader".equals(actor.userId()) && !key.equals("app-src/secret"));
        var grants = mock(IdentityPrincipalDirectory.class);
        var user = new QueryAccessService.GrantUser("reader", "domain-a");

        var visibleUse = new ApplicationPanelUse("overview", "app-src:overview", "panel-visible",
            "/applications/app-src/overview",
            null, Map.of("en", "Overview"), null, "visible");
        var hiddenUse = new ApplicationPanelUse("secret", "app-src:secret", "panel-hidden",
            "/applications/app-src/secret",
            null, Map.of("en", "Secret"), null, "hidden");
        var source = domainApp("app-src", "domain-a", "owner", "Source App");
        source.getJSONObject("entry").put("renderer", "panels");
        source.put("panelUses", List.of(visibleUse, hiddenUse));
        var visibleGroup = new ApplicationCatalog.Group("visible", Map.of("en", "Visible"), 0);
        source.put("groups", List.of(visibleGroup, new ApplicationCatalog.Group("hidden", Map.of("en", "Hidden"), 1)));
        source.put("panelSettings", JSONObject.of(
            "framePanelId", "builtin-product-frame",
            "theme", JSONObject.of("light", JSONObject.of("accent", "#123456"))));

        when(grants.principalNames(any(), any())).thenReturn(Map.of("owner", "Owner"));

        var catalog = spy(new ApplicationCatalog(mock(JdbcTemplate.class), mock(TransactionTemplate.class), access,
            "{}", mock(PanelResources.class), grants, authorization));
        doReturn(List.of(source)).when(catalog).all();

        var subject = authorization.resolveSubject(new VerifiedIdentity("domain-a", "system", CredentialLimit.UNRESTRICTED))
                .withJavaUserId("reader");
        var handler = new ApplicationController(catalog, null, null).applicationPanelEntries().handler();
        var entries = (JSONObject) handler.read(subject, Map.of("primaryKey", "app-src"));
        assertEquals("app-src", entries.getString("applicationId"));
        assertEquals(List.of(visibleUse), entries.get("panelUses"));
        assertEquals("overview", entries.getJSONObject("entry").getString("entryKey"));
        assertEquals("builtin-product-frame", entries.getString("framePanelId"));
        assertFalse(entries.containsKey("ownerName"));
        assertFalse(entries.containsKey("canEditEntries"));
        var entryRows = (JSONObject) new ApplicationController(catalog, null, null).applicationPanelEntryRows()
            .handler().read(subject, Map.of("primaryKey", "app-src"));
        assertEquals(List.of(visibleUse), entryRows.get("panelUses"));
        assertEquals(List.of(visibleGroup), entryRows.get("groups"));
        assertFalse(entryRows.getBooleanValue("canEditEntries"));
        verifyNoInteractions(grants);

        var foreign = new SubjectContext(new VerifiedIdentity("domain-b", "system", CredentialLimit.UNRESTRICTED),
            subject.roles(), subject.policyRefsByRole(), subject.objectPolicyIds(), subject.managementPolicyIds(),
            subject.liveDataPermission(), subject.javaUserId());
        var hidden = assertThrows(OwnerRefusal.class, () -> handler.read(foreign, Map.of("primaryKey", "app-src")));
        var missing = assertThrows(OwnerRefusal.class, () -> handler.read(subject, Map.of("primaryKey", "app-missing")));
        assertEquals(missing.getMessage(), hidden.getMessage());

        var record = catalog.catalogueRecord("app-src", user, Locale.ENGLISH);
        assertEquals(1, record.getJSONArray("panelUses").size());
        assertNotNull(record.getJSONObject("theme"));
        assertEquals("#123456", record.getJSONObject("theme").getJSONObject("light").getString("accent"));

        var deleteAvailability = new ApplicationController(catalog, null, null).applicationDeleteAvailability().handler();
        assertEquals(JSONObject.of("canMaintain", record.getBooleanValue("canMaintain")),
                deleteAvailability.read(subject, Map.of("primaryKey", "app-src")));
        var hiddenDelete = assertThrows(OwnerRefusal.class, () -> deleteAvailability.read(foreign, Map.of("primaryKey", "app-src")));
        var missingDelete = assertThrows(OwnerRefusal.class, () -> deleteAvailability.read(subject, Map.of("primaryKey", "app-missing")));
        assertEquals("APPLICATION_NOT_FOUND", hiddenDelete.code());
        assertEquals(hiddenDelete.code(), missingDelete.code());
        assertEquals(hiddenDelete.getMessage(), missingDelete.getMessage());

        var formReq = new ApplicationController.CatalogueFormRequest(
            "create",
            new ApplicationController.CatalogueFormTarget("object", null, "platform:Application", "app-src"),
            null,
            null,
            null);
        var draft = catalog.catalogueForm(formReq, user, Locale.ENGLISH);
        var values = draft.getJSONObject("values");
        assertNotNull(values);
        assertEquals(1, values.getJSONArray("panelUses").size());
        var copiedUse = values.getJSONArray("panelUses").getJSONObject(0);
        assertEquals("panel-visible", copiedUse.getString("panelId"));
        assertTrue(copiedUse.getString("path").startsWith("/applications/app-"));
        assertFalse(copiedUse.getString("path").contains("app-src"));
        assertTrue(copiedUse.getString("pageKey").startsWith("app-"));
        assertFalse(copiedUse.containsKey("access"));
        assertNotNull(values.getJSONObject("theme"));
    }

    private static JSONObject domainApp(String id, String domainId, String ownerUserId, String name) {
        return JSONObject.of(
            "id", id,
            "domainId", domainId,
            "ownerUserId", ownerUserId,
            "kind", "native",
            "entry", JSONObject.of("path", "/applications/" + id, "entryKey", "main"),
            "names", JSONObject.of("en", name),
            "descriptions", JSONObject.of("en", ""),
            "icon", "pages",
            "groups", List.of(),
            "panelUses", List.of(),
            "panelSettings", new JSONObject(),
            "allowStandalone", true,
            "updatedAt", Instant.parse("2026-11-25T10:00:00Z"));
    }

    private static JSONObject builtinApp(String id, String name) {
        return JSONObject.of(
            "id", id,
            "kind", "native",
            "entry", JSONObject.of("path", "/" + id, "renderer", id, "entryKey", "main"),
            "names", JSONObject.of("en", name),
            "descriptions", JSONObject.of("en", ""),
            "icon", "pages",
            "groups", List.of(),
            "panelUses", List.of(),
            "panelSettings", new JSONObject(),
            "allowStandalone", true,
            "updatedAt", Instant.parse("2026-11-25T09:00:00Z"));
    }
}

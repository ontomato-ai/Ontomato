package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.ProductPrincipalLookup;
import io.ontomato.dataengine.service.QueryAccessService;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

class ApplicationCatalogParityTest {
    @Test
    void catalogueSupportsNumericPageAndMineSharedScopes() {
        var access = mock(ApplicationAccess.class);
        var authorization = EntryAuthorizationFixture.allowEntries();
        var grants = mock(ProductPrincipalLookup.class);
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
    void copyFormFiltersHiddenEntriesAndExposesPublicThemeOnRecord() {
        var access = mock(ApplicationAccess.class);
        var authorization = EntryAuthorizationFixture.entries((actor, key) -> !key.equals("app-src/secret"));
        var grants = mock(ProductPrincipalLookup.class);
        var user = new QueryAccessService.GrantUser("reader", "domain-a");

        var visibleUse = new ApplicationPanelUse("overview", "app-src:overview", "panel-visible",
            "/applications/app-src/overview",
            null, Map.of("en", "Overview"));
        var hiddenUse = new ApplicationPanelUse("secret", "app-src:secret", "panel-hidden",
            "/applications/app-src/secret",
            null, Map.of("en", "Secret"));
        var source = domainApp("app-src", "domain-a", "owner", "Source App");
        source.getJSONObject("entry").put("renderer", "panels");
        source.put("panelUses", List.of(visibleUse, hiddenUse));
        source.put("panelSettings", JSONObject.of(
            "framePanelId", "builtin-product-frame",
            "theme", JSONObject.of("light", JSONObject.of("accent", "#123456"))));

        when(grants.principalNames(any(), any())).thenReturn(Map.of("owner", "Owner"));

        var catalog = spy(new ApplicationCatalog(mock(JdbcTemplate.class), mock(TransactionTemplate.class), access,
            "{}", mock(PanelResources.class), grants, authorization));
        doReturn(List.of(source)).when(catalog).all();

        var record = catalog.catalogueRecord("app-src", user, Locale.ENGLISH);
        assertEquals(1, record.getJSONArray("panelUses").size());
        assertNotNull(record.getJSONObject("theme"));
        assertEquals("#123456", record.getJSONObject("theme").getJSONObject("light").getString("accent"));

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

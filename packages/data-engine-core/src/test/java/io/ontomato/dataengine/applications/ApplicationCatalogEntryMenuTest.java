package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.ProductGrantService;
import io.ontomato.dataengine.service.QueryAccessService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

class ApplicationCatalogEntryMenuTest {
    @Test void singleEntryCountsRegisteredNamesBeforeFilteringForTheReader() {
        var access = mock(ApplicationAccess.class);
        var grants = mock(ProductGrantService.class);
        var user = new QueryAccessService.GrantUser("reader", "domain-a");
        var first = use("first", Map.of("en", "First"));
        var second = use("second", Map.of("en", "Second"));
        var only = use("only", Map.of("en", "Only"));
        var detail = use("detail", null);
        var multi = app("multi", List.of(first, second));
        var single = app("single", List.of(only, detail));
        var leaf = app("leaf", List.of());

        when(access.withPageSkillAuthorization(any(), any())).thenCallRealMethod();
        when(access.enterableApplicationIds(any(), any())).thenCallRealMethod();
        when(access.canEnter(any(), any())).thenReturn(true);
        when(access.panelUses(List.of(first, second), user)).thenReturn(List.of(first));
        when(access.panelUses(List.of(only, detail), user)).thenReturn(List.of(only, detail));
        when(grants.allowedBatchFor("domain-a", "reader", List.of(first.panelId()), "use"))
            .thenReturn(Map.of(first.panelId(), true));
        when(grants.allowedBatchFor("domain-a", "reader", List.of(only.panelId(), detail.panelId()), "use"))
            .thenReturn(Map.of(only.panelId(), true, detail.panelId(), true));

        var catalog = spy(new ApplicationCatalog(mock(JdbcTemplate.class), mock(TransactionTemplate.class), access,
            "{}", mock(PanelResources.class), grants));
        doReturn(List.of(multi, single, leaf)).when(catalog).all();

        var multiMenu = (ApplicationCatalog.EntryMenu) catalog.resolveEntry("multi", first.id(), user).get("menu");
        var singleMenu = (ApplicationCatalog.EntryMenu) catalog.resolveEntry("single", only.id(), user).get("menu");
        assertEquals(List.of(first), multiMenu.panelUses());
        assertFalse(multiMenu.singleEntry());
        assertEquals(List.of(only), singleMenu.panelUses());
        assertTrue(singleMenu.singleEntry());

        var views = catalog.visible(user);
        assertEquals(multiMenu.singleEntry(), views.get(0).getBooleanValue("singleEntry"));
        assertEquals(singleMenu.singleEntry(), views.get(1).getBooleanValue("singleEntry"));
        assertTrue(views.get(2).getBooleanValue("singleEntry"));

        var multiDetail = catalog.view("multi", user);
        assertEquals(List.of(first), multiDetail.getList("panelUses", ApplicationPanelUse.class));
        assertFalse(multiDetail.getBooleanValue("singleEntry"));
    }

    @Test void entryMenuIncludesFrameConversationWithoutAffectingGroupsOrSingleEntry() {
        var access = mock(ApplicationAccess.class);
        var grants = mock(ProductGrantService.class);
        var user = new QueryAccessService.GrantUser("reader", "domain-a");
        var conversation = new ApplicationPanelUse("ops-diagnosis", "ops-diagnosis", null, "/ops/diagnosis",
            new ApplicationPanelUse.Access(null, "domain-member"), null, null, null, null, null, null,
            ApplicationPanelUse.FRAME_CONVERSATION_KIND, null);
        var grouped = new ApplicationPanelUse("ops-results", "ops-results", "builtin-product-ops-results", "/ops/results",
            new ApplicationPanelUse.Access(null, "domain-member"), null, Map.of("en", "Test results"), null, null, "autotest", null, null, null);
        var detail = use("ops-case-detail", null);
        var autotestGroup = new ApplicationCatalog.Group("autotest", Map.of("en", "Automatic tests"), 10);
        var unusedGroup = new ApplicationCatalog.Group("unused", Map.of("en", "Unused"), 20);
        var app = JSONObject.of(
            "id", "operations",
            "kind", "native",
            "entry", JSONObject.of("path", "/ops", "renderer", "operations"),
            "names", Map.of("en", "Operations diagnosis"),
            "groups", List.of(autotestGroup, unusedGroup),
            "panelSettings", JSONObject.of("framePanelId", "builtin-product-ops-frame"),
            "panelUses", List.of(conversation, grouped, detail));

        when(access.withPageSkillAuthorization(any(), any())).thenCallRealMethod();
        when(access.canEnter(any(), any())).thenReturn(true);
        when(access.panelUses(List.of(conversation, grouped, detail), user)).thenReturn(List.of(conversation, grouped, detail));
        when(grants.allowedBatchFor("domain-a", "reader",
            List.of("builtin-product-ops-frame", grouped.panelId(), detail.panelId()), "use"))
            .thenReturn(Map.of("builtin-product-ops-frame", true, grouped.panelId(), true, detail.panelId(), true));

        var catalog = spy(new ApplicationCatalog(mock(JdbcTemplate.class), mock(TransactionTemplate.class), access,
            "{}", mock(PanelResources.class), grants));
        doReturn(List.of(app)).when(catalog).all();

        var fromConversation = (ApplicationCatalog.EntryMenu) catalog.resolveEntry("operations", conversation.id(), user).get("menu");
        var fromFeature = (ApplicationCatalog.EntryMenu) catalog.resolveEntry("operations", grouped.id(), user).get("menu");

        assertEquals(List.of(conversation, grouped), fromConversation.panelUses());
        assertEquals(List.of(conversation, grouped), fromFeature.panelUses());
        assertEquals(List.of(autotestGroup), fromConversation.groups());
        assertEquals(List.of(autotestGroup), fromFeature.groups());
        assertTrue(fromConversation.singleEntry());
        assertTrue(fromFeature.singleEntry());
    }

    private static ApplicationPanelUse use(String id, Map<String, String> names) {
        return new ApplicationPanelUse(id, id, "panel-" + id, "/" + id,
            new ApplicationPanelUse.Access(null, "domain-member"), null, names);
    }

    private static JSONObject app(String id, List<ApplicationPanelUse> uses) {
        return JSONObject.of("id", id, "kind", "native", "entry", JSONObject.of("path", "/" + id, "renderer", id),
            "names", Map.of("en", id), "groups", List.of(), "panelUses", uses);
    }
}

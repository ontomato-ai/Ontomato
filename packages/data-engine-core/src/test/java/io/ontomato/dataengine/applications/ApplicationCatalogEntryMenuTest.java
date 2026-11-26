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
import io.ontomato.dataengine.service.ProductPrincipalLookup;
import io.ontomato.dataengine.service.QueryAccessService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

class ApplicationCatalogEntryMenuTest {
    @Test void singleEntryCountsRegisteredNamesBeforeFilteringForTheReader() {
        var access = mock(ApplicationAccess.class);
        var authorization = EntryAuthorizationFixture.entries((actor, key) -> !key.equals("multi/second"));
        var grants = mock(ProductPrincipalLookup.class);
        var user = new QueryAccessService.GrantUser("reader", "domain-a");
        var first = use("first", Map.of("en", "First"));
        var second = use("second", Map.of("en", "Second"));
        var only = use("only", Map.of("en", "Only"));
        var detail = use("detail", null);
        var multi = app("multi", List.of(first, second));
        var single = app("single", List.of(only, detail));
        var leaf = app("leaf", List.of());



        var catalog = spy(new ApplicationCatalog(mock(JdbcTemplate.class), mock(TransactionTemplate.class), access,
            "{}", mock(PanelResources.class), grants, authorization));
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
        var authorization = EntryAuthorizationFixture.allowEntries();
        var grants = mock(ProductPrincipalLookup.class);
        var user = new QueryAccessService.GrantUser("reader", "domain-a");
        var conversation = new ApplicationPanelUse("ops-diagnosis", "ops-diagnosis", null, "/ops/diagnosis", null, null, null, null, null, null,
            ApplicationPanelUse.FRAME_CONVERSATION_KIND, null);
        var grouped = new ApplicationPanelUse("ops-results", "ops-results", "builtin-product-ops-results", "/ops/results", null, Map.of("en", "Test results"), null, null, "autotest", null, null, null);
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


        var catalog = spy(new ApplicationCatalog(mock(JdbcTemplate.class), mock(TransactionTemplate.class), access,
            "{}", mock(PanelResources.class), grants, authorization));
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

    @Test void mixedNativeApplicationKeepsItsDeclaredHomeBesideStructuredEntries() {
        var authorization = EntryAuthorizationFixture.entries((actor, key) ->
            key.equals("agents/agents") == actor.userId().equals("chat-reader"));
        var grants = mock(ProductPrincipalLookup.class);
        var settings = new ApplicationPanelUse("agents-agent-settings", "agents-agent-settings",
            "builtin-product-agent-settings", "/agents/settings", null, Map.of("en", "Settings"));
        var agents = app("agents", List.of(settings));
        agents.getJSONObject("entry").put("entryKey", "agents");
        agents.getJSONObject("entry").put("home", "/agents/chat");
        var catalog = spy(new ApplicationCatalog(mock(JdbcTemplate.class), mock(TransactionTemplate.class),
            mock(ApplicationAccess.class), "{}", mock(PanelResources.class), grants, authorization));
        doReturn(List.of(agents)).when(catalog).all();
        var chatReader = new QueryAccessService.GrantUser("chat-reader", "domain-a");
        var settingsReader = new QueryAccessService.GrantUser("settings-reader", "domain-a");


        var chat = catalog.resolveEntry("/agents/chat", chatReader).getObject("use", ApplicationPanelUse.class);
        assertEquals("agents", chat.id());
        assertTrue(chat.nativeEntry());
        assertEquals(List.of("/agents/chat"), catalog.visible(chatReader).getFirst().getList("entryPaths", String.class));
        assertEquals(settings, catalog.resolveEntry("/agents", settingsReader).getObject("use", ApplicationPanelUse.class));
        assertEquals(List.of(settings.path()), catalog.view("agents", settingsReader).getList("entryPaths", String.class));
    }

    private static ApplicationPanelUse use(String id, Map<String, String> names) {
        return new ApplicationPanelUse(id, id, "panel-" + id, "/" + id, null, names);
    }

    private static JSONObject app(String id, List<ApplicationPanelUse> uses) {
        return JSONObject.of("id", id, "kind", "native", "entry", JSONObject.of("path", "/" + id, "renderer", id, "entryKey", "main"),
            "names", Map.of("en", id), "groups", List.of(), "panelUses", uses);
    }
}

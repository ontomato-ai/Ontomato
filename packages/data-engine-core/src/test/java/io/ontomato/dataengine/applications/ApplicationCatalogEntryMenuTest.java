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

    private static ApplicationPanelUse use(String id, Map<String, String> names) {
        return new ApplicationPanelUse(id, id, "panel-" + id, "/" + id,
            new ApplicationPanelUse.Access(null, "domain-member"), null, names);
    }

    private static JSONObject app(String id, List<ApplicationPanelUse> uses) {
        return JSONObject.of("id", id, "kind", "native", "entry", JSONObject.of("path", "/" + id, "renderer", id),
            "names", Map.of("en", id), "groups", List.of(), "panelUses", uses);
    }
}

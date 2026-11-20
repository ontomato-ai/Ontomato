package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.ProductGrantService;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.test.PostgresTestDatabase;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionTemplate;

class ApplicationCatalogReconciliationTest extends PostgresTestDatabase {
    private ApplicationCatalog catalog;
    private MockMvc http;
    private ApplicationAccess access;
    private IdentityService identity;
    private ProductGrantService grants;
    private PanelResources panels;

    @BeforeEach void setup() {
        new ApplicationCatalogUpgrade(jdbc).afterPropertiesSet();
        access = mock(ApplicationAccess.class);
        identity = mock(IdentityService.class);
        grants = mock(ProductGrantService.class);
        panels = mock(PanelResources.class);
        catalog = new ApplicationCatalog(jdbc,
            new TransactionTemplate(new DataSourceTransactionManager(dataSource)), access, "{}", panels, grants);
        http = MockMvcBuilders.standaloneSetup(new ApplicationController(catalog, identity,
            new WorkbenchServiceAuthentication("test-service")))
            .setControllerAdvice(new ApplicationErrors())
            .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    }
    private ApplicationCatalog.Builtin builtin(String id, String kind) {
        return new ApplicationCatalog.Builtin(id, kind, "apps", "build", 1,
            JSONObject.of("path", "/"+id, "renderer", id), List.of("domain-member"), null,
            new ApplicationCatalog.Declaration(Map.of("en", id), Map.of(), "pages", List.of(), List.of(), List.of(), List.of()));
    }
    private List<Map<String,Object>> records() {
        return jdbc.queryForList("SELECT * FROM sys_application ORDER BY id");
    }
    @Test void completeWorkbenchDeclarationRemovesOnlyItsUndeclaredBuiltins() throws Exception {
        var current = builtin("agents", "native");
        catalog.builtins("workbench", List.of(current, builtin("agent-builder", "native"), builtin("old-link", "link")));
        catalog.builtins("data-engine", List.of(builtin("ontology", "native")));
        var user = new QueryAccessService.GrantUser("owner", "domain");
        catalog.publish("app-domain", current.declaration(), "release", user);
        catalog.publish("app-persisted", current.declaration(), "release", user);
        // A persisted non-builtin remains outside this service-owned builtin collection even without a domain.
        jdbc.update("UPDATE sys_application SET domain_id=NULL WHERE id='app-persisted'");
        var protectedRows = jdbc.queryForList("SELECT * FROM sys_application WHERE id IN ('ontology','app-domain','app-persisted') ORDER BY id");
        http.perform(post(ApplicationController.DECLARATIONS).header(WorkbenchServiceAuthentication.HEADER, "test-service")
            .contentType(MediaType.APPLICATION_JSON).content(new ObjectMapper().writeValueAsString(new ApplicationController.Batch(List.of(current)))))
            .andExpect(status().isOk());
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM sys_application WHERE id IN ('agent-builder','old-link')", Integer.class));
        assertEquals("agents", catalog.require("agents").getString("id"));
        assertEquals(protectedRows, jdbc.queryForList("SELECT * FROM sys_application WHERE id IN ('ontology','app-domain','app-persisted') ORDER BY id"));
    }
    @Test void invalidCompleteDeclarationRollsBackRetirement() throws Exception {
        catalog.builtins("workbench", List.of(builtin("agents", "native"), builtin("agent-builder", "native")));
        var before = records();
        http.perform(post(ApplicationController.DECLARATIONS).header(WorkbenchServiceAuthentication.HEADER, "test-service")
            .contentType(MediaType.APPLICATION_JSON).content(new ObjectMapper().writeValueAsString(
                new ApplicationController.Batch(List.of(builtin("bad-app", "hosted"))))))
            .andExpect(status().isBadRequest());
        assertEquals(before, records());
    }
    @Test void partialDataEngineDeclarationsKeepPreviouslyLoadedFiles() {
        catalog.builtins("data-engine", List.of(builtin("ontology", "native")));
        catalog.builtins("data-engine", List.of(builtin("browser", "native")));
        assertEquals("ontology", catalog.require("ontology").getString("id"));
        assertEquals("browser", catalog.require("browser").getString("id"));
    }

    @Test void aBuiltinCannotBorrowAnotherBuiltinsEntryCode() throws Exception {
        new ApplicationCatalogUpgrade.Builtins(catalog).afterPropertiesSet();
        var before = records();
        var original = builtin("other", "native");
        var use = new ApplicationPanelUse("detail", "detail", "panel-detail", "/other/detail",
            new ApplicationPanelUse.Access("data-browser", null), null, null);
        var metadata = original.declaration();
        var declaration = new ApplicationCatalog.Declaration(metadata.names(), metadata.descriptions(), metadata.icon(),
            metadata.groups(), metadata.permissions(), List.of(), List.of(use));
        var other = new ApplicationCatalog.Builtin(original.id(), original.kind(), original.rail(), original.category(), original.sort(),
            JSONObject.of("renderer", "panels", "path", "/other"), List.of("data-browser"), null, declaration);

        assertEquals(400, assertThrows(org.springframework.web.server.ResponseStatusException.class,
            () -> catalog.builtins("workbench", List.of(other))).getStatusCode().value());
        assertEquals(before, records());
    }

    @Test void managementRetainsFullUsesAndResolveReturnsTheSavedEntrySettings() throws Exception {
        var owner = new QueryAccessService.GrantUser("author", "domain");
        var viewer = new QueryAccessService.GrantUser("viewer", "domain");
        when(identity.getCurrentUser()).thenReturn(owner);
        when(grants.allowed(anyString(), eq("use"))).thenReturn(true);
        when(access.canEnter(any(), any())).thenReturn(true);
        when(access.canMaintain(any(), eq(owner))).thenReturn(true);
        when(access.panelUses(anyList(), any())).thenAnswer(call -> List.of(call.<List<ApplicationPanelUse>>getArgument(0).getFirst()));
        var path = "/platform/applications/app-school/panel-uses";
        http.perform(put(path).contentType(MediaType.APPLICATION_JSON).content("""
            {"entry":{"path":"/applications/app-school","renderer":"panels"},"entryAccess":["domain-member"],
             "declaration":{"names":{"en":"School"},"descriptions":{},"icon":"school",
               "groups":[{"key":"school","names":{"en":"School"},"sort":1}],
               "permissions":[{"code":"app:app-school:private","names":{"en":"Private"},"groupKey":"school","sort":1}]},
             "framePanelId":"panel-frame","theme":{"light":{"--el-color-primary":"#123456"}},
             "delivery":{"panels":["panel-frame","panel-school"],"projections":["projection-school"],"packages":[],"agents":[],"skills":[]},
             "panelUses":[
               {"id":"school","pageKey":"school","panelId":"panel-school","path":"/applications/app-school/main","access":{"kind":"domain-member"},
                "names":{"en":"School"},"groupKey":"school","inputs":{"term":{"literal":null}}},
               {"id":"private","pageKey":"private","panelId":"panel-school","path":"/applications/app-school/private",
                "access":{"permissionCode":"app:app-school:private"}}]}
            """)).andExpect(status().isOk());

        http.perform(get(path).param("purpose", "management")).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.panelUses.length()").value(2))
            .andExpect(jsonPath("$.data.declaration.permissions[0].code").value("app:app-school:private"))
            .andExpect(jsonPath("$.data.framePanelId").value("panel-frame"))
            .andExpect(jsonPath("$.data.delivery.projections[0]").value("projection-school"));
        when(identity.getCurrentUser()).thenReturn(viewer);
        http.perform(get(path).param("purpose", "management")).andExpect(status().isForbidden());
        http.perform(get(path)).andExpect(status().isOk()).andExpect(jsonPath("$.data.panelUses.length()").value(1));
        http.perform(get("/platform/applications/resolve-entry").param("path", "/applications/app-school/main"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.framePanelId").value("panel-frame"))
            .andExpect(jsonPath("$.data.theme.light['--el-color-primary']").value("#123456"))
            .andExpect(jsonPath("$.data.use.inputs.term.literal").hasJsonPath())
            .andExpect(jsonPath("$.data.delivery").doesNotHaveJsonPath());

        when(identity.getCurrentUser()).thenReturn(owner);
        http.perform(put(path).contentType(MediaType.APPLICATION_JSON).content("""
            {"entry":{"path":"/applications/app-school","renderer":"panels"},"panelUses":[]}
            """)).andExpect(status().isOk());
        http.perform(get(path).param("purpose", "management")).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.framePanelId").doesNotHaveJsonPath())
            .andExpect(jsonPath("$.data.theme").doesNotHaveJsonPath())
            .andExpect(jsonPath("$.data.delivery").doesNotHaveJsonPath())
            .andExpect(jsonPath("$.data.declaration.names.en").value("School"))
            .andExpect(jsonPath("$.data.entryAccess[0]").value("domain-member"));

    }

    @Test void objectBrowserDetailChecksReaderBeforeLookingUpTheClassAndChecksTheActualPanel() throws Exception {
        new ApplicationCatalogUpgrade.Builtins(catalog).afterPropertiesSet();
        var reader = new QueryAccessService.GrantUser("viewer", "domain");
        when(identity.getCurrentUser()).thenReturn(reader);
        http.perform(get("/platform/applications/resolve-entry").param("path", "/browser/detail/Customer"))
            .andExpect(status().isForbidden());
        verifyNoInteractions(panels, grants);

        when(access.canEnter(any(), eq(reader))).thenReturn(true);
        when(panels.objectDetailPanel("domain", "客户")).thenReturn("panel-customer");
        var detail = "/browser/detail/%E5%AE%A2%E6%88%B7";
        http.perform(get("/platform/applications/resolve-entry").param("path", detail)).andExpect(status().isForbidden());
        when(grants.allowed("panel-customer", "use")).thenReturn(true);
        http.perform(get("/platform/applications/resolve-entry").param("path", detail)).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.use.id").value("browser-detail:客户"))
            .andExpect(jsonPath("$.data.use.pageKey").value("browser-detail:客户"))
            .andExpect(jsonPath("$.data.use.path").value(detail))
            .andExpect(jsonPath("$.data.use.access.permissionCode").value("data-browser"))
            .andExpect(jsonPath("$.data.use.names").doesNotHaveJsonPath());
        http.perform(get("/platform/applications/resolve-entry").param("path", "/browser/detail/Unconfigured"))
            .andExpect(status().isNotFound());
    }

    @Test void browserDetailDerivesOnlyIdsThatFitTheContractAndRejectsPercentInTheClass() throws Exception {
        new ApplicationCatalogUpgrade.Builtins(catalog).afterPropertiesSet();
        var reader = new QueryAccessService.GrantUser("viewer", "domain");
        when(identity.getCurrentUser()).thenReturn(reader);
        when(access.canEnter(any(), eq(reader))).thenReturn(true);
        var root = "/browser/detail/";
        var resolve = "/platform/applications/resolve-entry";
        var limit = "x".repeat(185);
        var overLimit = limit + "x";
        when(panels.objectDetailPanel("domain", limit)).thenReturn("panel-customer");
        when(grants.allowed("panel-customer", "use")).thenReturn(true);

        http.perform(get(resolve).param("path", root + limit)).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.use.id").value("browser-detail:" + limit))
            .andExpect(jsonPath("$.data.use.pageKey").value("browser-detail:" + limit));
        assertAll(
            () -> http.perform(get(resolve).param("path", root + overLimit)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("185"))),
            () -> http.perform(get(resolve).param("path", root + "Discount%25")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("percent sign"))));
        verify(panels).objectDetailPanel("domain", limit);
        verifyNoMoreInteractions(panels);
    }

    @Test void upgradesStoredDefaultAgentTargetsWithoutChangingTheirMeaning() {
        catalog.builtins("data-engine", List.of(builtin("ontology", "native")));
        jdbc.update("UPDATE sys_application SET panel_uses=?::jsonb, page_skills=?::jsonb WHERE id='ontology'", """
            [{"id":"use","pageKey":"page","panelId":"panel","path":"/ontology/page",
              "access":{"kind":"domain-member"},"defaultAgentId":"saved-agent"},
             {"id":"other","pageKey":"other","panelId":"panel","path":"/ontology/other",
              "access":{"kind":"domain-member"}}]
            """, """
            [{"permissionCode":"business-knowledge","skill":{"namespace":{"kind":"provider","provider":"ontology"},
              "name":"knowledge-governance"},"defaults":[{"pageKey":"governance-report","agentKey":"knowledge-governance"}]}]
            """);

        new ApplicationCatalogUpgrade(jdbc).afterPropertiesSet();
        var app = catalog.require("ontology");
        var uses = app.getList("panelUses", ApplicationPanelUse.class);
        assertEquals(new DefaultAgentTarget("id", "saved-agent", null), uses.getFirst().defaultAgent());
        assertNull(uses.get(1).defaultAgent());
        var mapping = app.getList("pageSkills", PageSkills.Mapping.class).getFirst();
        assertEquals(new DefaultAgentTarget("preset", null, "knowledge-governance"), mapping.defaults().getFirst().defaultAgent());
        var upgraded = records();

        new ApplicationCatalogUpgrade(jdbc).afterPropertiesSet();
        assertEquals(upgraded, records());
    }

}

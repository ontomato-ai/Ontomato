package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.ProductGrantService;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.test.PostgresTestDatabase;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
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

    @Test void aNativeKnowledgeGroupKeepsItsGovernanceSkillAndPresetWithAnAdmittedPanelMember() throws Exception {
        new ApplicationCatalogUpgrade.Builtins(catalog).afterPropertiesSet();
        var ontology = JSON.parseObject(new ClassPathResource("applications/ontology.json").getContentAsString(StandardCharsets.UTF_8),
            ApplicationCatalog.Builtin.class);
        var metadata = ontology.declaration();
        var use = new ApplicationPanelUse("knowledge-use", "knowledge", "panel-knowledge", "/ontology/knowledge",
            new ApplicationPanelUse.Access("business-knowledge", null),
            new DefaultAgentTarget("id", "knowledge-agent", null), null);
        var declaration = new ApplicationCatalog.Declaration(metadata.names(), metadata.descriptions(), metadata.icon(),
            metadata.groups(), metadata.permissions(), metadata.pageSkills(), List.of(use));
        catalog.builtins("data-engine", List.of(new ApplicationCatalog.Builtin(ontology.id(), ontology.kind(), ontology.rail(),
            ontology.category(), ontology.sort(), ontology.entry(), ontology.entryAccess(), ontology.scheduleAdapter(), declaration)));

        var viewer = new QueryAccessService.GrantUser("viewer", "domain");
        when(identity.getCurrentUser()).thenReturn(viewer);
        when(access.canEnter(any(), eq(viewer))).thenReturn(true);
        when(access.pageSkills(anyList(), eq(viewer))).thenAnswer(call -> call.getArgument(0));
        when(access.panelUses(List.of(use), viewer)).thenReturn(List.of(use));
        when(grants.allowed("panel-knowledge", "use")).thenReturn(true);

        http.perform(get(ApplicationController.PANEL_SKILL_SOURCES).param("domainId", "domain")
                .header(WorkbenchServiceAuthentication.HEADER, "test-service"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[0].entrance.permissionCode").value("business-knowledge"))
            .andExpect(jsonPath("$.data[0].path").value("/ontology/knowledge"));
        http.perform(get("/platform/applications/ontology/panel-uses"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.entry.renderer").value("ontology"))
            .andExpect(jsonPath("$.data.panelUses[0].id").value("knowledge-use"));
        http.perform(get("/platform/applications/resolve-entry").param("path", "/ontology/knowledge"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.use.id").value("knowledge-use"));
        http.perform(get("/platform/page-skills")).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.pageSkills.length()").value(metadata.pageSkills().size()))
            .andExpect(jsonPath("$.data.pageSkills[0].skill.name").value("knowledge-governance"))
            .andExpect(jsonPath("$.data.pageSkills[0].defaults[0].pageKey").value("governance-report"))
            .andExpect(jsonPath("$.data.pageSkills[0].defaults[0].defaultAgent.agentKind").value("knowledge-governance"))
            .andExpect(jsonPath("$.data.pageSkills[0].defaults[1].pageKey").value("knowledge"))
            .andExpect(jsonPath("$.data.admittedEntrances[0].pageKey").value("knowledge"))
            .andExpect(jsonPath("$.data.registeredSkills[0].name").value("knowledge-governance"));
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
        var resolve = "/platform/applications/resolve-entry";
        var byPath = http.perform(get(resolve).param("path", "/applications/app-school/main"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.framePanelId").value("panel-frame"))
            .andExpect(jsonPath("$.data.theme.light['--el-color-primary']").value("#123456"))
            .andExpect(jsonPath("$.data.use.inputs.term.literal").hasJsonPath())
            .andExpect(jsonPath("$.data.delivery").doesNotHaveJsonPath()).andReturn().getResponse().getContentAsString();
        var byUse = http.perform(get(resolve).param("applicationId", "app-school").param("useId", "school"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertEquals(JSON.parseObject(byPath), JSON.parseObject(byUse));
        http.perform(get(resolve).param("applicationId", "app-school").param("useId", "private"))
            .andExpect(status().isForbidden());
        http.perform(get(resolve).param("applicationId", "app-school").param("useId", "missing"))
            .andExpect(status().isNotFound());
        http.perform(get(resolve).param("applicationId", "app-school")).andExpect(status().isBadRequest());
        http.perform(get(resolve).param("path", "/applications/app-school/main")
                .param("applicationId", "app-school").param("useId", "school")).andExpect(status().isBadRequest());

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
        http.perform(get("/platform/applications/resolve-entry").param("applicationId", "browser")
                .param("useId", "browser-detail:客户"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.use.path").value(detail));
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

    private static final String CATALOGUE = "/platform/applications/catalogue";
    private static final String CATALOGUE_APP = "/platform/applications/app-catalogue/panel-uses";
    private static final String CATALOGUE_REGISTRATION = """
        {"entry":{"path":"/applications/app-catalogue","renderer":"panels"},"entryAccess":["domain-member"],
         "declaration":{"names":{"en":"Catalogue demo","zh-CN":"目录示例"},"descriptions":{"en":"Find me"},"icon":"pages",
          "groups":[],"permissions":[]},
         "panelUses":[
          {"id":"public","pageKey":"public","panelId":"panel-public","path":"/applications/app-catalogue/public","access":{"kind":"domain-member"}},
          {"id":"hidden","pageKey":"hidden","panelId":"panel-hidden","path":"/applications/app-catalogue/hidden","access":{"kind":"domain-member"}}]}
        """;

    @Test void catalogueReadsDifferFromNavigationAndKeepsAnAuthorizedEditorsCompleteEntryTable() throws Exception {
        var owner = new QueryAccessService.GrantUser("owner", "domain");
        var reader = new QueryAccessService.GrantUser("reader", "domain");
        var foreign = new QueryAccessService.GrantUser("foreign", "another-domain");
        when(identity.getCurrentUser()).thenReturn(owner);
        when(grants.allowed(anyString(), eq("use"))).thenReturn(true);
        when(access.canMaintain(any(), eq(owner))).thenReturn(true);
        when(access.canEnter(any(), eq(reader))).thenReturn(true);
        when(access.panelUses(anyList(), eq(reader))).thenAnswer(call -> call.getArgument(0));
        when(grants.allowedFor("domain", "owner", "app-catalogue", "edit")).thenReturn(true);
        catalog.builtins("data-engine", List.of(builtin("browser", "native")));
        catalog.publish("app-hosted", builtin("hosted", "native").declaration(), "release", owner);
        catalog.publish("app-private-foreign", builtin("foreign", "native").declaration(), "release", foreign);
        http.perform(put(CATALOGUE_APP).contentType(MediaType.APPLICATION_JSON).content(CATALOGUE_REGISTRATION))
            .andExpect(status().isOk());

        when(grants.allowed("panel-hidden", "use")).thenReturn(false);
        http.perform(get(CATALOGUE).param("scope", "maintainable").param("size", "1"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.rows[0].id").value("app-catalogue"))
            .andExpect(jsonPath("$.data.rows[0].source").value("domain"))
            .andExpect(jsonPath("$.data.rows[0].canMaintain").value(true))
            .andExpect(jsonPath("$.data.rows[0].canGrant").value(true))
            .andExpect(jsonPath("$.data.rows[0].canEditEntries").value(true))
            .andExpect(jsonPath("$.data.rows[0].entryCount").value(2))
            .andExpect(jsonPath("$.data.nextCursor").value("app-catalogue"));
        http.perform(get(CATALOGUE).param("scope", "maintainable").param("cursor", "app-catalogue"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.rows.length()").value(1))
            .andExpect(jsonPath("$.data.rows[0].id").value("app-hosted"))
            .andExpect(jsonPath("$.data.rows[0].canMaintain").value(true))
            .andExpect(jsonPath("$.data.rows[0].canEditEntries").value(false));
        http.perform(get(CATALOGUE + "/app-catalogue")).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.panelUses.length()").value(2))
            .andExpect(jsonPath("$.data.entryAccess[0]").value("domain-member"));
        http.perform(post(CATALOGUE + "/form").contentType(MediaType.APPLICATION_JSON).content("""
            {"section":"entries","target":{"kind":"object","objectType":"platform:Application","primaryKey":"app-catalogue"},"changedField":null}
            """)).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.values.panelUses.length()").value(2))
            .andExpect(jsonPath("$.data.save.path").value(CATALOGUE_APP));

        var before = catalog.require("app-catalogue").getJSONArray("panelUses");
        http.perform(put("/platform/applications/app-catalogue/identity").contentType(MediaType.APPLICATION_JSON).content("""
            {"names":{"en":"Renamed demo"},"descriptions":{"en":"Find me"},"icon":"boxes"}
            """)).andExpect(status().isOk());
        assertEquals(before, catalog.require("app-catalogue").getJSONArray("panelUses"));
        when(identity.getCurrentUser()).thenReturn(reader);
        http.perform(get(CATALOGUE).param("search", "FIND ME")).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.rows.length()").value(1))
            .andExpect(jsonPath("$.data.rows[0].names.en").value("Renamed demo"))
            .andExpect(jsonPath("$.data.rows[0].entryCount").value(1));
        http.perform(get(CATALOGUE).param("search", "browser")).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.rows[0].source").value("builtin"))
            .andExpect(jsonPath("$.data.rows[0].canMaintain").value(false));
        http.perform(get(CATALOGUE + "/app-catalogue")).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.panelUses.length()").value(1))
            .andExpect(jsonPath("$.data.entryAccess").doesNotHaveJsonPath());
        http.perform(get(CATALOGUE + "/app-private-foreign")).andExpect(status().isNotFound());
    }

    @Test void typedFormsReportFieldErrorsAndDraftCreationNeverOverwritesARegisteredApplication() throws Exception {
        var owner = new QueryAccessService.GrantUser("owner", "domain");
        when(identity.getCurrentUser()).thenReturn(owner);
        when(access.canMaintain(any(), eq(owner))).thenReturn(true);
        when(grants.allowed(anyString(), eq("use"))).thenReturn(true);

        var form = http.perform(post(CATALOGUE + "/form").contentType(MediaType.APPLICATION_JSON).content("""
            {"section":"create","target":{"kind":"draft"},"changedField":null}
            """)).andExpect(status().isOk()).andReturn();
        var data = JSONObject.parseObject(form.getResponse().getContentAsString()).getJSONObject("data");
        var saved = data.getJSONObject("save").getString("path");
        assertTrue(saved.matches("/platform/applications/app-[a-f0-9-]{36}/panel-uses[?]create=true"));
        assertTrue(records().isEmpty());
        var values = data.getJSONObject("values");
        var id = values.getJSONObject("entry").getString("path").substring("/applications/".length());
        var declaration = values.getJSONObject("declaration");
        declaration.getJSONObject("names").put("en", "New catalogue");
        declaration.put("groups", com.alibaba.fastjson2.JSONArray.of((Object) null));
        http.perform(post(CATALOGUE + "/form").contentType(MediaType.APPLICATION_JSON)
                .content(JSONObject.of("section", "create", "target", JSONObject.of("kind", "draft", "id", id), "values", values).toJSONString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.errors[0].field").value("/declaration/groups"))
            .andExpect(jsonPath("$.data.save.path").value(saved));
        declaration.put("groups", List.of());
        http.perform(put(saved).contentType(MediaType.APPLICATION_JSON).content(values.toJSONString()))
            .andExpect(status().isOk());
        var before = records();
        http.perform(put(saved).contentType(MediaType.APPLICATION_JSON).content(values.toJSONString()))
            .andExpect(status().isConflict());
        assertEquals(before, records());

        http.perform(post(CATALOGUE + "/form").contentType(MediaType.APPLICATION_JSON).content("""
            {"section":"identity","target":{"kind":"object","objectType":"platform:Application","primaryKey":"%s"},
             "values":{"names":{"en":"Example"},"descriptions":{},"icon":"bad icon"},"changedField":"/icon"}
            """.formatted(id))).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.errors[0].field").value("/icon"))
            .andExpect(jsonPath("$.data.save.path").value("/platform/applications/" + id + "/identity"));
        assertEquals(before, records());
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

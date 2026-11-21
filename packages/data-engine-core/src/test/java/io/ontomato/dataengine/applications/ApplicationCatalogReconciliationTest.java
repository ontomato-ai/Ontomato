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
import com.sun.net.httpserver.HttpServer;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.ProductGrantService;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.test.PostgresTestDatabase;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;
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

    @Test void startupBuiltinsReconciliationRemovesRetiredDataEngineApplications() throws Exception {
        catalog.builtins("data-engine", List.of(builtin("governance", "native")));
        catalog.builtins("workbench", List.of(builtin("agents", "native")));

        new ApplicationCatalogUpgrade.Builtins(catalog).afterPropertiesSet();

        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM sys_application WHERE id='governance'", Integer.class));
        assertEquals("ontology", catalog.require("ontology").getString("id"));
        assertEquals("agents", catalog.require("agents").getString("id"));
    }

    @Test void aNativeKnowledgeGroupKeepsItsGovernanceSkillAndPresetWithAnAdmittedPanelMember() throws Exception {
        new ApplicationCatalogUpgrade.Builtins(catalog).afterPropertiesSet();
        var ontology = JSON.parseObject(new ClassPathResource("applications/ontology.json").getContentAsString(StandardCharsets.UTF_8),
            ApplicationCatalog.Builtin.class);
        var metadata = ontology.declaration();
        var mapping = new PageSkills.Mapping("business-knowledge", null, null,
            new PageSkills.Skill(new PageSkills.Namespace("provider", "ontology", null), "knowledge-governance"), List.of());
        var use = new ApplicationPanelUse("knowledge-use", "knowledge", "builtin-product-knowledge", "/ontology/knowledge",
            new ApplicationPanelUse.Access("business-knowledge", null),
            new DefaultAgentTarget("id", "knowledge-agent", null), null);
        var declaration = new ApplicationCatalog.Declaration(metadata.names(), metadata.descriptions(), metadata.icon(),
            metadata.groups(), metadata.permissions(), List.of(mapping), List.of(use));
        catalog.builtins("data-engine", List.of(new ApplicationCatalog.Builtin(ontology.id(), ontology.kind(), ontology.rail(),
            ontology.category(), ontology.sort(), ontology.entry(), ontology.entryAccess(), ontology.scheduleAdapter(), declaration)));

        var viewer = new QueryAccessService.GrantUser("viewer", "domain");
        when(identity.getCurrentUser()).thenReturn(viewer);
        when(access.canEnter(any(), eq(viewer))).thenReturn(true);
        when(access.pageSkills(anyList(), eq(viewer))).thenAnswer(call -> call.getArgument(0));
        when(access.panelUses(List.of(use), viewer)).thenReturn(List.of(use));
        when(grants.allowed("builtin-product-knowledge", "use")).thenReturn(true);

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
            .andExpect(jsonPath("$.data.pageSkills.length()").value(1))
            .andExpect(jsonPath("$.data.pageSkills[0].skill.name").value("knowledge-governance"))
            .andExpect(jsonPath("$.data.pageSkills[0].defaults.length()").value(1))
            .andExpect(jsonPath("$.data.pageSkills[0].defaults[0].pageKey").value("knowledge"))
            .andExpect(jsonPath("$.data.pageSkills[0].defaults[0].defaultAgent.id").value("knowledge-agent"))
            .andExpect(jsonPath("$.data.admittedEntrances[0].pageKey").value("knowledge"))
            .andExpect(jsonPath("$.data.registeredSkills[0].name").value("knowledge-governance"));
    }

    @Test void aDuplicateKeyNamesTheFileAndTheKey() {
        var source = new ByteArrayResource("""
            {"declaration":{"panelUses":[],"panelUses":[]}}
            """.getBytes(StandardCharsets.UTF_8), "applications/duplicate.json");

        var error = assertThrows(IOException.class, () -> ApplicationCatalogUpgrade.Builtins.readDeclaration(source));

        assertTrue(error.getMessage().contains("applications/duplicate.json"));
        assertTrue(error.getMessage().contains("panelUses"));
    }

    @Test void theShippedOntologyDeclarationContainsTheComponentsEntry() throws IOException {
        var ontology = ApplicationCatalogUpgrade.Builtins.readDeclaration(new ClassPathResource("applications/ontology.json"));

        var components = ontology.declaration().panelUses().stream()
            .filter(use -> use.path().equals("/ontology/components"))
            .findFirst().orElseThrow();
        assertEquals("builtin-product-sdk-components", components.panelId());
        assertEquals("ontology-modeling", components.access().permissionCode());
    }

    @Test void builtinDescriptionsRoundTripWithoutAddingANamelessEntryToTheMenu() throws Exception {
        var source = new ByteArrayResource("""
            {"id":"descriptions-test","kind":"native","rail":"apps","category":"build","sort":100,
             "entry":{"path":"/descriptions-test","renderer":"descriptions"},"entryAccess":["domain-member"],
             "declaration":{"names":{"en":"Descriptions"},"descriptions":{},"icon":"pages","groups":[],"permissions":[],
               "panelUses":[
                 {"id":"info","pageKey":"descriptions-info","path":"/descriptions-test/info","panelId":"builtin-product-info",
                  "access":{"kind":"domain-member"},"descriptions":{"en":"  Keep the original text.  ","zh-CN":"入口说明"}},
                 {"id":"plain","pageKey":"descriptions-plain","path":"/descriptions-test/plain","panelId":"builtin-product-info",
                  "access":{"kind":"domain-member"}}]}}
            """.getBytes(StandardCharsets.UTF_8), "applications/descriptions-test.json");
        var viewer = new QueryAccessService.GrantUser("viewer", "domain");
        when(identity.getCurrentUser()).thenReturn(viewer);
        when(access.canEnter(any(), eq(viewer))).thenReturn(true);
        when(access.panelUses(anyList(), eq(viewer))).thenAnswer(call -> call.getArgument(0));
        when(grants.allowed("builtin-product-info", "use")).thenReturn(true);

        catalog.builtins("data-engine", List.of(ApplicationCatalogUpgrade.Builtins.readDeclaration(source)));

        http.perform(get("/platform/applications/resolve-entry").param("path", "/descriptions-test/info"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.use.descriptions.en").value("  Keep the original text.  "))
            .andExpect(jsonPath("$.data.use.descriptions['zh-CN']").value("入口说明"))
            .andExpect(jsonPath("$.data.use.names").doesNotHaveJsonPath())
            .andExpect(jsonPath("$.data.menu.panelUses.length()").value(0));
        http.perform(get("/platform/applications/catalogue/descriptions-test"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.panelUses[0].descriptions.en").value("  Keep the original text.  "))
            .andExpect(jsonPath("$.data.panelUses[1].descriptions").doesNotHaveJsonPath());
    }

    private static String registrationWithEntryDescriptions(String descriptions) {
        return """
            {"entry":{"path":"/applications/app-descriptions","renderer":"panels"},
             "declaration":{"names":{"en":"Descriptions"},"descriptions":{},"icon":"pages","groups":[],"permissions":[]},
             "entryAccess":["domain-member"],
             "panelUses":[{"id":"info","pageKey":"app-descriptions-info","path":"/applications/app-descriptions/info",
               "panelId":"info-panel","access":{"kind":"domain-member"},"descriptions":%s}]}
            """.formatted(descriptions);
    }

    @Test void domainEntryDescriptionsRoundTripAndRejectInvalidValues() throws Exception {
        var viewer = new QueryAccessService.GrantUser("owner", "domain");
        when(identity.getCurrentUser()).thenReturn(viewer);
        when(access.canEnter(any(), eq(viewer))).thenReturn(true);
        when(access.canMaintain(any(), eq(viewer))).thenReturn(true);
        when(access.panelUses(anyList(), eq(viewer))).thenAnswer(call -> call.getArgument(0));
        when(grants.allowed("info-panel", "use")).thenReturn(true);

        var writer = "/platform/applications/app-descriptions/panel-uses";
        http.perform(put(writer).contentType(MediaType.APPLICATION_JSON)
                .content(registrationWithEntryDescriptions("""
                    {"en":"Read it here.","fr-CA":"Consultez la fiche."}
                    """)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.panelUses[0].descriptions['fr-CA']").value("Consultez la fiche."));
        http.perform(post("/platform/applications/catalogue/form").contentType(MediaType.APPLICATION_JSON).content("""
            {"section":"entries","target":{"kind":"object","objectType":"platform:Application","primaryKey":"app-descriptions"}}
            """)).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.values.panelUses[0].descriptions.en").value("Read it here."));
        for (var invalid : List.of("null", "{}", "{\"fr\":\"Explication\"}", "{\"en\":\"   \"}",
                "{\"en\":\"Read it.\",\"fr\":\"  \"}", "{\"en\":42}", "{\"en\":null}", "{\"en\":\"\u00a0\ufeff\"}"))
            http.perform(put(writer).contentType(MediaType.APPLICATION_JSON)
                .content(registrationWithEntryDescriptions(invalid))).andExpect(status().isBadRequest());

        http.perform(get("/platform/applications/resolve-entry").param("applicationId", "app-descriptions").param("useId", "info"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.use.descriptions.en").value("Read it here."));
    }

    @Test void builtinDeclarationsCannotPointToDomainPanels() {
        var before = records();
        var privatePanel = builtInBrowser("domain-panel");
        var error = assertThrows(org.springframework.web.server.ResponseStatusException.class,
            () -> catalog.builtins("data-engine", List.of(privatePanel)));
        assertEquals(400, error.getStatusCode().value());
        assertEquals(before, records());
        verifyNoInteractions(panels);
    }

    @Test void theShippedOntologyCatalogueEntriesKeepTheirModelingPermission() throws Exception {
        new ApplicationCatalogUpgrade.Builtins(catalog).afterPropertiesSet();
        var viewer = new QueryAccessService.GrantUser("modeler", "domain");
        when(identity.getCurrentUser()).thenReturn(viewer);
        when(access.canEnter(any(), eq(viewer))).thenReturn(true);
        when(access.panelUses(anyList(), eq(viewer))).thenAnswer(call -> call.getArgument(0));

        for (var name : List.of("projections", "panels", "applications")) {
            when(grants.allowed("builtin-product-ontology-" + name, "use")).thenReturn(true);
        }
        for (var name : List.of("projections", "panels", "applications")) {
            http.perform(get("/platform/applications/resolve-entry").param("path", "/ontology/" + name))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.applicationId").value("ontology"))
                .andExpect(jsonPath("$.data.use.panelId").value("builtin-product-ontology-" + name))
                .andExpect(jsonPath("$.data.use.access.permissionCode").value("ontology-modeling"));
        }
        when(access.panelUses(anyList(), eq(viewer))).thenReturn(List.of());
        http.perform(get("/platform/applications/resolve-entry").param("path", "/ontology/projections"))
            .andExpect(status().isForbidden());
    }

    private static String panelsTrialRegistration(String id) {
        return """
            {"entry":{"path":"/applications/%1$s","renderer":"panels"},
             "declaration":{"names":{"en":"Panel trial"},"descriptions":{},"icon":"pages","permissions":[],"groups":[]},
             "entryAccess":["domain-member"],"panelUses":[
               {"id":"trial","pageKey":"ontology-panels","panelId":"trial-panel","path":"/applications/%1$s/trial",
                "access":{"kind":"domain-member"},"names":{"en":"Trial"}},
               {"id":"other","pageKey":"other-page","panelId":"trial-panel","path":"/applications/%1$s/other",
                "access":{"kind":"domain-member"},"names":{"en":"Other"}}]}
            """.formatted(id);
    }

    @Test void startupKeepsTheBuiltinAndQuarantinesOnlyTheConflictingDomainUse() throws Exception {
        var operator = new QueryAccessService.GrantUser("operator", "trial-domain");
        when(identity.getCurrentUser()).thenReturn(operator);
        when(access.canEnter(any(), eq(operator))).thenReturn(true);
        when(access.canMaintain(any(), eq(operator))).thenReturn(true);
        when(access.pageSkills(anyList(), eq(operator))).thenAnswer(call -> call.getArgument(0));
        when(access.panelUses(anyList(), eq(operator))).thenAnswer(call -> call.getArgument(0));
        when(grants.allowed(anyString(), eq("use"))).thenReturn(true);

        var id = "app-ontology-panels";
        var path = "/applications/" + id;
        http.perform(put("/platform/applications/" + id + "/panel-uses").contentType(MediaType.APPLICATION_JSON)
                .content(panelsTrialRegistration(id))).andExpect(status().isOk());

        new ApplicationCatalogUpgrade.Builtins(catalog).afterPropertiesSet();

        http.perform(get("/platform/applications/resolve-entry").param("path", "/ontology/panels"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.applicationId").value("ontology"))
            .andExpect(jsonPath("$.data.use.pageKey").value("ontology-panels"));
        http.perform(get("/platform/applications/resolve-entry").param("path", path + "/trial"))
            .andExpect(status().isNotFound());
        http.perform(get("/platform/applications/resolve-entry").param("applicationId", id).param("useId", "trial"))
            .andExpect(status().isNotFound());
        http.perform(get("/platform/applications/resolve-entry").param("path", path + "/other"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.use.id").value("other"));
        http.perform(get("/platform/applications/" + id + "/panel-uses"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.panelUses[*].id").value(org.hamcrest.Matchers.contains("other")));
        http.perform(get("/platform/page-skills")).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.admittedEntrances[?(@.pageKey == 'ontology-panels')].permissionCode")
                .value(org.hamcrest.Matchers.contains("ontology-modeling")));
        http.perform(get(ApplicationController.PANEL_SKILL_SOURCES).param("domainId", "trial-domain")
                .header(WorkbenchServiceAuthentication.HEADER, "test-service"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data[?(@.applicationId == 'app-ontology-panels')].useId")
                .value(org.hamcrest.Matchers.contains("other")));
        http.perform(post("/platform/applications/catalogue/form").contentType(MediaType.APPLICATION_JSON).content("""
            {"section":"entries","target":{"kind":"object","objectType":"platform:Application","primaryKey":"app-ontology-panels"}}
            """)).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.values.panelUses.length()").value(2))
            .andExpect(jsonPath("$.data.errors[0].field").value("/panelUses/0/pageKey"))
            .andExpect(jsonPath("$.data.errors[0].message").value(org.hamcrest.Matchers.allOf(
                org.hamcrest.Matchers.containsString("ontology-panels"), org.hamcrest.Matchers.containsString("/ontology/panels"),
                org.hamcrest.Matchers.containsString("trial-domain"), org.hamcrest.Matchers.containsString(id))));
    }

    @Test void domainRegistrationNamesTheBuiltinEntryThatReservedThePageKey() throws Exception {
        new ApplicationCatalogUpgrade.Builtins(catalog).afterPropertiesSet();
        var operator = new QueryAccessService.GrantUser("operator", "trial-domain");
        when(identity.getCurrentUser()).thenReturn(operator);
        when(grants.allowed(anyString(), eq("use"))).thenReturn(true);

        var response = http.perform(put("/platform/applications/app-new-trial/panel-uses")
                .contentType(MediaType.APPLICATION_JSON).content(panelsTrialRegistration("app-new-trial")))
            .andExpect(status().isBadRequest()).andReturn().getResponse().getContentAsString();
        assertTrue(response.contains("ontology-panels"));
        assertTrue(response.contains("/ontology/panels"));
        assertTrue(response.contains("built-in application 'ontology'"));
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM sys_application WHERE id='app-new-trial'", Integer.class));
    }

    @Test void aBuiltinEntryResolvesTheSamePanelForTwoDomainsWithoutGrantRows() throws Exception {
        var resourceGrants = new ProductGrantService(jdbc, identity, (userId, domainId) -> java.util.Set.of());
        resourceGrants.afterPropertiesSet();
        var actualCatalog = new ApplicationCatalog(jdbc,
            new TransactionTemplate(new DataSourceTransactionManager(dataSource)), access, "{}", panels, resourceGrants);
        actualCatalog.builtins("data-engine", List.of(builtInBrowser("builtin-product-browser")));
        var first = new QueryAccessService.GrantUser("one", "domain-one");
        var second = new QueryAccessService.GrantUser("two", "domain-two");
        when(access.canEnter(any(), any())).thenReturn(true);
        when(access.panelUses(anyList(), any())).thenAnswer(call -> call.getArgument(0));
        var mvc = MockMvcBuilders.standaloneSetup(new ApplicationController(actualCatalog, identity,
            new WorkbenchServiceAuthentication("test-service"))).setControllerAdvice(new ApplicationErrors()).build();
        var request = get("/platform/applications/resolve-entry").param("path", "/browser/data");
        for (var reader : List.of(first, second)) {
            when(identity.getCurrentUser()).thenReturn(reader);
            mvc.perform(request).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.applicationId").value("browser"))
                .andExpect(jsonPath("$.data.use.panelId").value("builtin-product-browser"))
                .andExpect(jsonPath("$.data.use.access.permissionCode").value("data-browser"));
        }
        when(access.panelUses(anyList(), eq(second))).thenReturn(List.of());
        mvc.perform(request).andExpect(status().isForbidden());
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM product_grant", Integer.class));
        verifyNoInteractions(panels);

        var localUse = new ApplicationPanelUse("local", "local", "builtin-product-browser", "/applications/app-local/home",
            new ApplicationPanelUse.Access(null, "domain-member"), null, null);
        var registration = new ApplicationController.PanelRegistration(
            new ApplicationController.PanelEntry("/applications/app-local", "panels"), List.of(localUse),
            builtin("local", "native").declaration(), List.of("domain-member"));
        actualCatalog.putPanelUses("app-local", registration, second);
        assertEquals("builtin-product-browser",
            actualCatalog.require("app-local").getList("panelUses", ApplicationPanelUse.class).getFirst().panelId());
        verify(panels).requireCurrent("domain-two", null, List.of(localUse), null, null, "pages");
    }

    private ApplicationCatalog.Builtin builtInBrowser(String panelId) {
        var use = new ApplicationPanelUse("browse", "browse", panelId, "/browser/data",
            new ApplicationPanelUse.Access("data-browser", null), null, null);
        var metadata = builtin("browser", "native").declaration();
        var declaration = new ApplicationCatalog.Declaration(metadata.names(), metadata.descriptions(), metadata.icon(),
            metadata.groups(), metadata.permissions(), List.of(), List.of(use));
        return new ApplicationCatalog.Builtin("browser", "native", "apps", "build", 1,
            JSONObject.of("path", "/browser", "renderer", "panels"), List.of("data-browser"), null, declaration);
    }

    @Test void aBuiltinCannotBorrowAnotherBuiltinsEntryCode() throws Exception {
        new ApplicationCatalogUpgrade.Builtins(catalog).afterPropertiesSet();
        var before = records();
        var original = builtin("other", "native");
        var use = new ApplicationPanelUse("detail", "detail", "builtin-product-detail", "/other/detail",
            new ApplicationPanelUse.Access("data-browser", null), null, null);
        var metadata = original.declaration();
        var declaration = new ApplicationCatalog.Declaration(metadata.names(), metadata.descriptions(), metadata.icon(),
            metadata.groups(), metadata.permissions(), List.of(), List.of(use));
        var other = new ApplicationCatalog.Builtin(original.id(), original.kind(), original.rail(), original.category(), original.sort(),
            JSONObject.of("renderer", "panels", "path", "/other"), List.of("data-browser"), null, declaration);

        var refusal = assertThrows(org.springframework.web.server.ResponseStatusException.class,
            () -> catalog.builtins("workbench", List.of(other)));
        assertEquals(400, refusal.getStatusCode().value());
        assertTrue(refusal.getReason().contains("data-browser"));
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
               "permissions":[{"code":"app:app-school:private","names":{"en":"Private","zh-CN":"仅限内部"},"groupKey":"school","sort":1}]},
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

        var form = http.perform(post(CATALOGUE + "/form").locale(Locale.SIMPLIFIED_CHINESE)
                .contentType(MediaType.APPLICATION_JSON).content("""
                    {"section":"entries","target":{"kind":"object","objectType":"platform:Application","primaryKey":"app-school"}}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.values.panelUses[0].names.en").value("School"))
            .andExpect(jsonPath("$.data.values.panelUses[1].names").doesNotHaveJsonPath())
            .andExpect(jsonPath("$.data.values.panelUses[1].descriptions").doesNotHaveJsonPath())
            .andReturn().getResponse().getContentAsString();
        var rowFields = JSON.parseObject(form).getJSONObject("data").getJSONArray("fields").getJSONObject(1)
            .getJSONObject("control").getJSONArray("itemFields").toJavaList(JSONObject.class);
        for (var fieldPath : List.of("/names", "/descriptions")) {
            var field = rowFields.stream().filter(item -> fieldPath.equals(item.getString("path"))).findFirst().orElseThrow();
            var control = field.getJSONObject("control");
            assertEquals("localized-text", control.getString("kind"));
            assertEquals("zh-CN", control.getString("primaryLocale"));
            assertEquals(List.of("en"), control.getList("requiredLocales", String.class));
            assertFalse(field.getBooleanValue("required"));
        }
        var accessField = rowFields.stream().filter(item -> "/access".equals(item.getString("path"))).findFirst().orElseThrow();
        var accessControl = accessField.getJSONObject("control");
        assertTrue(accessField.getBooleanValue("required"));
        assertEquals("select", accessControl.getString("kind"));
        var options = accessControl.getJSONArray("options");
        assertEquals(JSONObject.of("kind", "domain-member"), options.getJSONObject(0).getJSONObject("value"));
        assertEquals("本域成员", options.getJSONObject(0).getString("label"));
        assertEquals(JSONObject.of("permissionCode", "app:app-school:private"), options.getJSONObject(1).getJSONObject("value"));
        assertEquals("仅限内部", options.getJSONObject(1).getString("label"));
        var defaultAgent = rowFields.stream().filter(item -> "/defaultAgent".equals(item.getString("path"))).findFirst().orElseThrow();
        assertFalse(defaultAgent.getBooleanValue("required"));
        assertEquals(JSONObject.of("kind", "select", "options", List.of()), defaultAgent.getJSONObject("control"));
        when(identity.getCurrentUser()).thenReturn(viewer);
        http.perform(get(path).param("purpose", "management")).andExpect(status().isForbidden());
        http.perform(get(path)).andExpect(status().isOk()).andExpect(jsonPath("$.data.panelUses.length()").value(1));
        var resolve = "/platform/applications/resolve-entry";
        var byPath = http.perform(get(resolve).param("path", "/applications/app-school/main"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.framePanelId").value("panel-frame"))
            .andExpect(jsonPath("$.data.theme.light['--el-color-primary']").value("#123456"))
            .andExpect(jsonPath("$.data.use.inputs.term.literal").hasJsonPath())
            .andExpect(jsonPath("$.data.menu.panelUses[0].inputs.term.literal").hasJsonPath())
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
        http.perform(get(CATALOGUE + "/app-hosted")).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.entry.path").value("/apps/app-hosted/"))
            .andExpect(jsonPath("$.data.entry.renderer").doesNotHaveJsonPath());
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

    @Test void applicationDraftUsesTheReadersLanguageAndKeepsTranslationMaps() throws Exception {
        var owner = new QueryAccessService.GrantUser("owner", "domain");
        when(identity.getCurrentUser()).thenReturn(owner);

        http.perform(post(CATALOGUE + "/form").locale(Locale.SIMPLIFIED_CHINESE)
                .contentType(MediaType.APPLICATION_JSON).content("""
                    {"section":"create","target":{"kind":"draft","id":"app-translated"},
                     "values":{"declaration":{"names":{"en":"App","zh-CN":"应用","ko-KR":"앱"},
                                              "descriptions":{"zh-CN":"应用说明"},"icon":"pages",
                                              "groups":[{"key":"tools","names":{"en":"Tools","zh-CN":"工具"},"sort":7}],
                                              "permissions":[{"code":"app:app-translated:read","names":{"en":"Read","zh-CN":"查看"},
                                                              "groupKey":"tools","sort":3}]},
                               "entry":{"path":"/applications/app-translated","renderer":"panels"},
                               "entryAccess":["domain-member"],"panelUses":[]}}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.fields[0].label").value("应用身份"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[0].label").value("名称"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[0].help").isNotEmpty())
            .andExpect(jsonPath("$.data.fields[0].control.fields[0].control.kind").value("localized-text"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[0].control.primaryLocale").value("zh-CN"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[0].control.requiredLocales[0]").value("en"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[1].label").value("说明"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[1].control.multiline").value(true))
            .andExpect(jsonPath("$.data.fields[0].control.fields[2].label").value("图标"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[2].control.kind").value("application-icon"))
            .andExpect(jsonPath("$.data.values.declaration.icon").value("pages"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[3].control.kind").value("object-array"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[3].control.itemFields[0].path").value("/key"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[3].control.itemFields[1].control.kind").value("localized-text"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[3].control.itemFields[1].control.primaryLocale").value("zh-CN"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[3].control.itemFields[2].control.kind").value("number"))
            .andExpect(jsonPath("$.data.values.declaration.groups[0].names['zh-CN']").value("工具"))
            .andExpect(jsonPath("$.data.values.declaration.groups[0].sort").value(7))
            .andExpect(jsonPath("$.data.fields[0].control.fields[4].label").value("菜单权限"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[4].refreshOnChange").value(true))
            .andExpect(jsonPath("$.data.fields[0].control.fields[4].control.itemFields[0].refreshOnChange").value(true))
            .andExpect(jsonPath("$.data.fields[0].control.fields[4].control.itemFields[1].refreshOnChange").value(true))
            .andExpect(jsonPath("$.data.fields[2].control.itemFields[8].control.options[1].value.permissionCode").value("app:app-translated:read"))
            .andExpect(jsonPath("$.data.fields[2].control.itemFields[8].control.options[1].label").value("查看"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[4].control.kind").value("object-array"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[4].control.itemKeyPath").doesNotHaveJsonPath())
            .andExpect(jsonPath("$.data.fields[0].control.fields[4].control.defaultItem.code").value("app:app-translated:"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[4].control.itemFields[0].label").value("权限码"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[4].control.itemFields[1].control.kind").value("localized-text"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[4].control.itemFields[1].control.requiredLocales[0]").value("en"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[4].control.itemFields[2].path").value("/groupKey"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[4].control.itemFields[3].control.kind").value("number"))
            .andExpect(jsonPath("$.data.values.declaration.permissions[0].names['zh-CN']").value("查看"))
            .andExpect(jsonPath("$.data.fields[1].path").value("/entry/path"))
            .andExpect(jsonPath("$.data.fields[1].label").value("应用地址"))
            .andExpect(jsonPath("$.data.fields[1].control.kind").value("text"))
            .andExpect(jsonPath("$.data.values.entry.renderer").value("panels"))
            .andExpect(jsonPath("$.data.values.declaration.names['ko-KR']").value("앱"))
            .andExpect(jsonPath("$.data.values.declaration.descriptions['zh-CN']").value("应用说明"));
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
        declaration.put("groups", List.of(JSONObject.of("key", "tools", "names", JSONObject.of("en", "Tools"), "sort", 0)));
        var permission = JSONObject.of("code", ApplicationCatalog.permissionPrefix(id) + "read",
            "names", JSONObject.of("en", ""), "groupKey", "tools", "sort", 3);
        declaration.put("permissions", List.of(permission));
        http.perform(post(CATALOGUE + "/form").contentType(MediaType.APPLICATION_JSON)
                .content(JSONObject.of("section", "create", "target", JSONObject.of("kind", "draft", "id", id), "values", values).toJSONString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.errors[0].field").value("/declaration/permissions/0/names/en"));
        permission.getJSONObject("names").put("en", "Read");
        http.perform(put(saved).contentType(MediaType.APPLICATION_JSON).content(values.toJSONString()))
            .andExpect(status().isOk());
        assertEquals(permission, catalog.require(id).getJSONArray("permissions").getJSONObject(0));
        var before = records();
        http.perform(put(saved).contentType(MediaType.APPLICATION_JSON).content(values.toJSONString()))
            .andExpect(status().isConflict());
        assertEquals(before, records());

        http.perform(post(CATALOGUE + "/form").contentType(MediaType.APPLICATION_JSON).content("""
            {"section":"identity","target":{"kind":"object","objectType":"platform:Application","primaryKey":"%s"},
             "values":{"names":{"en":"Example"},"descriptions":{},"icon":42},"changedField":"/icon"}
            """.formatted(id))).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.errors[0].field").value("/icon"))
            .andExpect(jsonPath("$.data.save.path").value("/platform/applications/" + id + "/identity"));
        assertEquals(before, records());
    }

    @Test void resolvesNativePanelEntriesAndTheirMenusWithoutFrameThemeOrInputs() throws Exception {
        var declared = builtin("native-frame-demo", "native");
        var use = new ApplicationPanelUse("overview", "native-frame-demo-overview", "builtin-product-overview",
            "/native-frame-demo/overview", new ApplicationPanelUse.Access(null, "domain-member"), null,
            Map.of("en", "Overview"), Map.of("en", "Explain the overview"),
            Map.of("term", Map.of("literal", "autumn")), "main");
        var metadata = new ApplicationCatalog.Declaration(Map.of("en", "Native example"), Map.of(), "pages",
            List.of(new ApplicationCatalog.Group("main", Map.of("en", "Main"), 1)), List.of(), List.of(), List.of(use));
        catalog.builtins("data-engine", List.of(new ApplicationCatalog.Builtin(declared.id(), declared.kind(),
            declared.rail(), declared.category(), declared.sort(), declared.entry(), declared.entryAccess(),
            declared.scheduleAdapter(), metadata)));
        jdbc.update("UPDATE sys_application SET panel_settings=?::jsonb WHERE id=?", """
            {"framePanelId":"stale-frame","theme":{"light":{"--el-color-primary":"#123456"}}}
            """, declared.id());
        var viewer = new QueryAccessService.GrantUser("viewer", "domain");
        when(identity.getCurrentUser()).thenReturn(viewer);
        when(access.canEnter(any(), eq(viewer))).thenReturn(true);
        when(access.panelUses(anyList(), eq(viewer))).thenAnswer(call -> call.getArgument(0));
        when(grants.allowed(use.panelId(), "use")).thenReturn(true);

        var route = "/platform/applications/resolve-entry";
        var byPath = http.perform(get(route).param("path", use.path()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.framePanelId").doesNotHaveJsonPath())
            .andExpect(jsonPath("$.data.theme").doesNotHaveJsonPath())
            .andExpect(jsonPath("$.data.use.inputs").doesNotHaveJsonPath())
            .andExpect(jsonPath("$.data.use.descriptions.en").value("Explain the overview"))
            .andExpect(jsonPath("$.data.menu.groups[0].key").value("main"))
            .andExpect(jsonPath("$.data.menu.panelUses[0].id").value("overview"))
            .andExpect(jsonPath("$.data.menu.panelUses[0].inputs").doesNotHaveJsonPath())
            .andReturn().getResponse().getContentAsString();
        var byUse = http.perform(get(route).param("applicationId", declared.id()).param("useId", use.id()))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertEquals(JSON.parseObject(byPath), JSON.parseObject(byUse));
        assertEquals(use, catalog.require(declared.id()).getList("panelUses", ApplicationPanelUse.class).getFirst());
    }

    @Test void validatesOnlyNewAndChangedIconsWhilePreservingLegacyIcons() throws Exception {
        var owner = new QueryAccessService.GrantUser("owner", "domain");
        when(identity.getCurrentUser()).thenReturn(owner);
        when(access.canMaintain(any(), eq(owner))).thenReturn(true);
        var path = "/platform/applications/app-icon-proof/panel-uses";
        var registration = JSON.parseObject("""
            {"entry":{"path":"/applications/app-icon-proof","renderer":"panels"},"entryAccess":["domain-member"],
             "declaration":{"names":{"en":"Original"},"descriptions":{},"icon":"pages","groups":[],"permissions":[]},
             "panelUses":[]}
            """);
        http.perform(put(path).contentType(MediaType.APPLICATION_JSON).content(registration.toJSONString()))
            .andExpect(status().isOk());
        verify(panels).requireCurrent("domain", null, List.of(), null, null, "pages");
        jdbc.update("UPDATE sys_application SET icon=? WHERE id=?", "ontology", "app-icon-proof");
        var declaration = registration.getJSONObject("declaration");
        declaration.put("icon", "ontology");
        declaration.put("names", JSONObject.of("en", "Renamed"));
        clearInvocations(panels);
        http.perform(put(path).contentType(MediaType.APPLICATION_JSON).content(registration.toJSONString()))
            .andExpect(status().isOk());
        verify(panels).requireCurrent("domain", null, List.of(), null, null, null);

        var identityPath = "/platform/applications/app-icon-proof/identity";
        var update = JSONObject.of("names", JSONObject.of("en", "Renamed again"), "descriptions", new JSONObject(), "icon", "ontology");
        clearInvocations(panels);
        http.perform(put(identityPath).contentType(MediaType.APPLICATION_JSON).content(update.toJSONString()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.icon").value("ontology"));
        verifyNoInteractions(panels);

        doThrow(ApplicationCatalog.bad("Icon is reserved")).when(panels)
            .requireCurrent("domain", null, List.of(), null, null, "settings");
        update.put("icon", "settings");
        http.perform(put(identityPath).contentType(MediaType.APPLICATION_JSON).content(update.toJSONString()))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("Icon is reserved"));
        assertEquals("ontology", catalog.require("app-icon-proof").getString("icon"));
    }

    @Test void registrationReportsARefusedDefaultAgentOnItsSubmittedEntryRow() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var reason = "Entry 'history' default agent preset 'knowledge-governance' does not select the skill for panel 'panel-overview'.";
        var payload = JSONObject.of("error", JSONObject.of(
            "code", "PAGE_DEFAULT_AGENT_UNAVAILABLE", "message", reason, "useId", "history"));
        server.createContext("/internal/product-panels/validate-references", exchange -> {
            try {
                var body = payload.toJSONString().getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(409, body.length);
                exchange.getResponseBody().write(body);
            } finally {
                exchange.close();
            }
        });
        server.start();
        try {
            var panelClient = new PanelResources("http://127.0.0.1:" + server.getAddress().getPort(), "test-service");
            var remoteCatalog = new ApplicationCatalog(jdbc, new TransactionTemplate(new DataSourceTransactionManager(dataSource)),
                access, "{}", panelClient, grants);
            var mvc = MockMvcBuilders.standaloneSetup(new ApplicationController(remoteCatalog, identity,
                    new WorkbenchServiceAuthentication("test-service")))
                .setControllerAdvice(new ApplicationErrors())
                .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
            when(identity.getCurrentUser()).thenReturn(new QueryAccessService.GrantUser("owner", "domain"));
            when(grants.allowed("panel-overview", "use")).thenReturn(true);

            mvc.perform(put("/platform/applications/app-default-agent-proof/panel-uses")
                    .param("create", "true").contentType(MediaType.APPLICATION_JSON).content("""
                    {"entry":{"path":"/applications/app-default-agent-proof","renderer":"panels"},"entryAccess":["domain-member"],
                     "declaration":{"names":{"en":"Default agent proof"},"descriptions":{},"icon":"pages","groups":[],"permissions":[]},
                     "panelUses":[
                       {"id":"overview","pageKey":"overview-proof","panelId":"panel-overview",
                        "path":"/applications/app-default-agent-proof/overview","access":{"kind":"domain-member"}},
                       {"id":"history","pageKey":"history-proof","panelId":"panel-overview",
                        "path":"/applications/app-default-agent-proof/history","access":{"kind":"domain-member"},
                        "defaultAgent":{"kind":"preset","agentKind":"knowledge-governance"}}]}
                    """)).andExpect(status().isConflict())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.code").value("PAGE_DEFAULT_AGENT_UNAVAILABLE"))
                .andExpect(jsonPath("$.message").value(reason))
                .andExpect(jsonPath("$.errors[0].field").value("/values/panelUses/1/defaultAgent"))
                .andExpect(jsonPath("$.errors[0].code").value("target_unavailable"))
                .andExpect(jsonPath("$.errors[0].message").value(reason));
            assertTrue(records().isEmpty());
        } finally {
            server.stop(0);
        }
    }

    @Test void registrationForwardsRawThemeAndLeavesRefusedSettingsUnwritten() throws Exception {
        var captured = new AtomicReference<JSONObject>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var refusal = """
            {"error":{"code":"INVALID_PANEL_ENTRY_INPUT","message":"Entry 'overview' input 'term' references frame state 'term' without a frame panel"}}
            """.strip();
        server.createContext("/internal/product-panels/validate-references", exchange -> {
            try {
                captured.set(JSON.parseObject(exchange.getRequestBody().readAllBytes()));
                var body = refusal.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(400, body.length);
                exchange.getResponseBody().write(body);
            } finally {
                exchange.close();
            }
        });
        server.start();
        try {
            var panelClient = new PanelResources("http://127.0.0.1:" + server.getAddress().getPort(), "test-service");
            var remoteCatalog = new ApplicationCatalog(jdbc, new TransactionTemplate(new DataSourceTransactionManager(dataSource)),
                access, "{}", panelClient, grants);
            var mvc = MockMvcBuilders.standaloneSetup(new ApplicationController(remoteCatalog, identity,
                    new WorkbenchServiceAuthentication("test-service")))
                .setControllerAdvice(new ApplicationErrors())
                .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
            when(identity.getCurrentUser()).thenReturn(new QueryAccessService.GrantUser("owner", "domain"));
            when(grants.allowed("panel-overview", "use")).thenReturn(true);

            var body = """
                {"entry":{"path":"/applications/app-native-settings","renderer":"panels"},"entryAccess":["domain-member"],
                 "declaration":{"names":{"en":"Settings"},"descriptions":{},"icon":"pages","groups":[],"permissions":[]},
                 "panelUses":[{"id":"overview","pageKey":"frame-demo-overview","panelId":"panel-overview",
                   "path":"/applications/app-native-settings/overview","access":{"kind":"domain-member"},
                   "inputs":{"term":{"frameState":"term"}}}]}
                """;
            var raw = JSON.parseObject(body);
            var theme = JSON.parseObject("""
                {"light":{"--el-color-primary":3},"unexpected":{"--el-color-primary":"#123456"}}
                """);
            raw.put("theme", theme);
            mvc.perform(put("/platform/applications/app-native-settings/panel-uses").contentType(MediaType.APPLICATION_JSON)
                    .content(raw.toJSONString())).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(refusal));
            assertEquals(theme, captured.get().getJSONObject("theme"));
            assertEquals("pages", captured.get().getString("icon"));
            assertEquals("term", captured.get().getJSONArray("uses").getJSONObject(0).getJSONObject("inputs")
                .getJSONObject("term").getString("frameState"));
            assertFalse(captured.get().containsKey("framePanelId"));

            mvc.perform(put("/platform/applications/app-native-settings/panel-uses").contentType(MediaType.APPLICATION_JSON)
                    .content(body)).andExpect(status().isBadRequest());
            assertFalse(captured.get().containsKey("theme"));

            mvc.perform(put("/platform/applications/app-native-settings/panel-uses").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"theme\":null," + body.strip().substring(1))).andExpect(status().isBadRequest());
            assertTrue(captured.get().containsKey("theme"));
            assertNull(captured.get().get("theme"));
            assertTrue(records().isEmpty());
        } finally {
            server.stop(0);
        }
    }

    @Test void referencePreflightForwardsConfiguredDefaultsAndOmitsUnsetDefaults() throws Exception {
        var requests = new AtomicReference<JSONObject>();
        var serviceHeader = new AtomicReference<String>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/product-panels/validate-references", exchange -> {
            try {
                serviceHeader.set(exchange.getRequestHeaders().getFirst(WorkbenchServiceAuthentication.HEADER));
                requests.set(JSON.parseObject(exchange.getRequestBody().readAllBytes()));
                exchange.sendResponseHeaders(204, -1);
            } finally {
                exchange.close();
            }
        });
        server.start();
        try {
            var remote = new PanelResources("http://127.0.0.1:" + server.getAddress().getPort(), "test-service");
            var member = new ApplicationPanelUse.Access(null, "domain-member");
            remote.requireCurrent("domain", null, List.of(
                new ApplicationPanelUse("report", "report", "panel-report", "/example/report", member,
                    new DefaultAgentTarget("preset", null, "knowledge-governance"), null),
                new ApplicationPanelUse("plan", "plan", "panel-plan", "/example/plan", member,
                    new DefaultAgentTarget("id", "planner", null), null),
                new ApplicationPanelUse("ordinary", "ordinary", "panel-ordinary", "/example/ordinary", member, null, null)
            ), null, null, null);

            assertEquals("test-service", serviceHeader.get());
            var uses = requests.get().getJSONArray("uses");
            assertEquals(JSONObject.of("kind", "preset", "agentKind", "knowledge-governance"),
                uses.getJSONObject(0).getJSONObject("defaultAgent"));
            assertEquals(JSONObject.of("kind", "id", "id", "planner"), uses.getJSONObject(1).getJSONObject("defaultAgent"));
            assertFalse(uses.getJSONObject(2).containsKey("defaultAgent"));
        } finally {
            server.stop(0);
        }
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

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
import io.ontomato.dataengine.service.IdentityPrincipalDirectory;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.test.PostgresTestDatabase;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

class ApplicationCatalogReconciliationTest extends PostgresTestDatabase {
    private ApplicationCatalog catalog;
    private final java.util.Set<String> deniedEntries = new java.util.HashSet<>();
    private final io.ontomato.dataengine.service.authorization.AuthorizationService authorization =
        EntryAuthorizationFixture.entries((actor, key) -> !deniedEntries.contains(actor.userId() + ":" + key));
    private MockMvc http;
    private ApplicationAccess access;
    private IdentityService identity;
    private IdentityPrincipalDirectory grants;
    private PanelResources panels;

    @BeforeEach void setup() {
        new ApplicationCatalogUpgrade(jdbc).afterPropertiesSet();
        new ApplicationEntryEvents(jdbc).run();
        access = mock(ApplicationAccess.class);
        identity = mock(IdentityService.class);
        when(identity.workbenchSubjectId(any())).thenAnswer(call ->
            call.getArgument(0, io.ontomato.dataengine.core.bean.User.class).getId());
        grants = mock(IdentityPrincipalDirectory.class);


        panels = mock(PanelResources.class);
        catalog = new ApplicationCatalog(jdbc,
            new TransactionTemplate(new DataSourceTransactionManager(dataSource)), access, "{}", panels, grants, authorization);
        http = MockMvcBuilders.standaloneSetup(new ApplicationController(catalog, identity,
            new WorkbenchServiceAuthentication("test-service")))
            .setControllerAdvice(new ApplicationErrors())
            .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    }
    private ApplicationCatalog.Builtin builtin(String id, String kind) {
        return new ApplicationCatalog.Builtin(id, kind, "apps", "build", 1,
            JSONObject.of("path", "/"+id, "renderer", id, "entryKey", "main"), null,
            new ApplicationCatalog.Declaration(Map.of("en", id), Map.of(), "pages", List.of(), List.of()));
    }
    private List<Map<String,Object>> records() {
        return jdbc.queryForList("SELECT * FROM sys_application ORDER BY id");
    }

    @Test void keepsExistingDomainAndClasspathEntryRegistrationsAfterUpgrade() throws Exception {
        new ApplicationCatalogUpgrade.Builtins(catalog).afterPropertiesSet();
        var author = new QueryAccessService.GrantUser("author", "domain");
        when(identity.getCurrentUser()).thenReturn(author);
        EntryAuthorizationFixture.allowEdit(authorization, author, null);
        http.perform(put("/platform/applications/app-upgrade/panel-uses").contentType(MediaType.APPLICATION_JSON).content("""
            {"entry":{"path":"/applications/app-upgrade","renderer":"panels"},"initialOpenEntryIds":[],
             "declaration":{"names":{"en":"Upgrade"},"descriptions":{},"icon":"pages","groups":[]},
             "panelUses":[{"id":"browse","names":{"en":"Browse"},"pageKey":"upgrade-browse","panelId":"panel-upgrade",
               "path":"/applications/app-upgrade/browse"}]}
            """)).andExpect(status().isOk());
        var upgrade = new ApplicationCatalogUpgrade(jdbc);
        upgrade.afterPropertiesSet();
        upgrade.afterPropertiesSet();

        var roots = catalog.affectedEntryRoots(null, Set.of("panel-upgrade", "builtin-product-skills-library"));
        assertTrue(roots.stream().anyMatch(row -> row.entryId().equals("app-upgrade/browse") && "domain".equals(row.domainId())));
        assertTrue(roots.stream().anyMatch(row -> row.entryId().equals("ontology/ontology-skills") && row.domainId() == null));
        assertEquals("panel-upgrade", catalog.panelReadRegistrations("domain").apply("app-upgrade", "browse").use().panelId());
    }

    /** A user application row as the retired hosted publication used to create it, for catalogue fixtures. */
    private void publishFixture(String id, ApplicationCatalog.Declaration d, QueryAccessService.GrantUser user) {
        jdbc.update("""
            INSERT INTO sys_application(id,domain_id,owner_service,owner_user_id,kind,names,descriptions,icon,rail,category,sort,entry,schedule_adapter,release_id,groups,entry_path,panel_uses,panel_settings,allow_standalone,updated_at)
            VALUES(?,?,?,?,?,?::jsonb,?::jsonb,?,?,?,?,?::jsonb,?,?,?::jsonb,?,?::jsonb,?::jsonb,?,now())
            ON CONFLICT(id) DO UPDATE SET names=excluded.names,descriptions=excluded.descriptions,updated_at=now()
            """, id, user.domainId(), "workbench", user.id(), "hosted",
            JSON.toJSONString(d.names()), JSON.toJSONString(d.descriptions()), d.icon(), "apps", "business", 100,
            JSONObject.of("path", "/apps/" + id + "/", "entryKey", "main").toJSONString(), null, "release",
            JSON.toJSONString(d.groups()), "/apps/" + id + "/",
            JSON.toJSONString(d.panelUses()), "{}", true);
    }
    @Test void completeWorkbenchDeclarationRemovesOnlyItsUndeclaredBuiltins() throws Exception {
        var current = builtin("agents", "native");
        catalog.builtins("workbench", List.of(current, builtin("agent-builder", "native"), builtin("old-link", "link")));
        catalog.builtins("data-engine", List.of(builtin("ontology", "native")));
        var user = new QueryAccessService.GrantUser("owner", "domain");
        publishFixture("app-domain", current.declaration(), user);
        publishFixture("app-persisted", current.declaration(), user);
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

        assertEquals("builtin-product-ontology-frame", ontology.framePanelId());
        assertEquals(List.of("facts", "capabilities", "governance", "products"),
            ontology.declaration().groups().stream().map(ApplicationCatalog.Group::key).toList());
        var components = ontology.declaration().panelUses().stream()
            .filter(use -> use.path().equals("/ontology/components"))
            .findFirst().orElseThrow();
        assertEquals("builtin-product-sdk-components", components.panelId());
        assertEquals("products", components.groupKey());
    }

    @Test void builtinNativeApplicationResolvesItsDeclaredBuiltinFramePanelId() throws Exception {
        var declared = builtin("native-framed-demo", "native");
        var use = new ApplicationPanelUse("overview", "native-framed-demo-overview", "builtin-product-overview",
            "/native-framed-demo/overview", null,
            Map.of("en", "Overview"), null, null, null);
        var metadata = new ApplicationCatalog.Declaration(Map.of("en", "Native framed"), Map.of(), "pages",
            List.of(), List.of(use));
        catalog.builtins("data-engine", List.of(new ApplicationCatalog.Builtin(declared.id(), declared.kind(),
            declared.rail(), declared.category(), declared.sort(), declared.entry(),
            declared.scheduleAdapter(), metadata, null, "builtin-product-native-frame")));

        var viewer = new QueryAccessService.GrantUser("viewer", "domain");
        when(identity.getCurrentUser()).thenReturn(viewer);

        http.perform(get("/platform/applications/resolve-entry").param("path", use.path()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.framePanelId").value("builtin-product-native-frame"));
        http.perform(get("/platform/applications").param("purpose", "navigation"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[?(@.id=='native-framed-demo')].framePanelId").value("builtin-product-native-frame"));
    }

    @Test void builtinDescriptionsRoundTripForNamedEntriesOutsideTheMenu() throws Exception {
        var source = new ByteArrayResource("""
            {"id":"descriptions-test","kind":"native","rail":"apps","category":"build","sort":100,
             "entry":{"path":"/descriptions-test","renderer":"descriptions"},"initialOpenEntryIds":[],
             "declaration":{"names":{"en":"Descriptions"},"descriptions":{},"icon":"pages","groups":[],
               "panelUses":[
                 {"id":"info","names":{"en":"Information"},"inMenu":false,"pageKey":"descriptions-info","path":"/descriptions-test/info","panelId":"builtin-product-info","descriptions":{"en":"  Keep the original text.  ","zh-CN":"入口说明"}},
                 {"id":"plain","names":{"en":"Plain"},"inMenu":false,"pageKey":"descriptions-plain","path":"/descriptions-test/plain","panelId":"builtin-product-info"}]}}
            """.getBytes(StandardCharsets.UTF_8), "applications/descriptions-test.json");
        var viewer = new QueryAccessService.GrantUser("viewer", "domain");
        when(identity.getCurrentUser()).thenReturn(viewer);

        catalog.builtins("data-engine", List.of(ApplicationCatalogUpgrade.Builtins.readDeclaration(source)));

        http.perform(get("/platform/applications/resolve-entry").param("path", "/descriptions-test/info"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.use.descriptions.en").value("  Keep the original text.  "))
            .andExpect(jsonPath("$.data.use.descriptions['zh-CN']").value("入口说明"))
            .andExpect(jsonPath("$.data.use.names.en").value("Information"))
            .andExpect(jsonPath("$.data.menu.panelUses.length()").value(0));
        http.perform(get("/platform/applications/catalogue/descriptions-test"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.panelUses[0].descriptions.en").value("  Keep the original text.  "))
            .andExpect(jsonPath("$.data.panelUses[1].descriptions").doesNotHaveJsonPath());
    }

    private static String registrationWithEntryDescriptions(String descriptions) {
        return """
            {"entry":{"path":"/applications/app-descriptions","renderer":"panels"},
             "declaration":{"names":{"en":"Descriptions"},"descriptions":{},"icon":"pages","groups":[]},
             "initialOpenEntryIds":[],
             "panelUses":[{"id":"info","names":{"en":"Information"},"pageKey":"app-descriptions-info","path":"/applications/app-descriptions/info",
               "panelId":"info-panel","descriptions":%s}]}
            """.formatted(descriptions);
    }

    @Test void domainEntryDescriptionsRoundTripAndRejectInvalidValues() throws Exception {
        var viewer = new QueryAccessService.GrantUser("owner", "domain");
        when(identity.getCurrentUser()).thenReturn(viewer);
        EntryAuthorizationFixture.allowEdit(authorization, viewer, null);

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
        for (var invalid : List.of("null", "{}", "{\"en\":\"   \"}",
                "{\"en\":\"Read it.\",\"fr\":\"  \"}", "{\"en\":42}", "{\"en\":null}", "{\"en\":\"\u00a0\ufeff\"}"))
            http.perform(put(writer).contentType(MediaType.APPLICATION_JSON)
                .content(registrationWithEntryDescriptions(invalid))).andExpect(status().isBadRequest());

        // Non-English-only entry descriptions are accepted too.
        http.perform(put(writer).contentType(MediaType.APPLICATION_JSON)
                .content(registrationWithEntryDescriptions("""
                    {"fr":"Explication"}
                    """)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.panelUses[0].descriptions.fr").value("Explication"));
        http.perform(put(writer).contentType(MediaType.APPLICATION_JSON)
                .content(registrationWithEntryDescriptions("""
                    {"en":"Read it here.","fr-CA":"Consultez la fiche."}
                    """)))
            .andExpect(status().isOk());

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

    @Test void theShippedOntologyCatalogueEntriesUseTheirStableKeys() throws Exception {
        new ApplicationCatalogUpgrade.Builtins(catalog).afterPropertiesSet();
        var viewer = new QueryAccessService.GrantUser("modeler", "domain");
        when(identity.getCurrentUser()).thenReturn(viewer);

        for (var name : List.of("projections", "panels", "applications")) {
            http.perform(get("/platform/applications/resolve-entry").param("path", "/ontology/" + name))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.applicationId").value("ontology"))
                .andExpect(jsonPath("$.data.use.panelId").value("builtin-product-ontology-" + name))
                .andExpect(jsonPath("$.data.use.id").value("use-ontology-" + name));
        }
        deniedEntries.add("modeler:ontology/use-ontology-projections");
        http.perform(get("/platform/applications/resolve-entry").param("path", "/ontology/projections"))
            .andExpect(status().isForbidden());
    }

    private static String panelsTrialRegistration(String id) {
        return """
            {"entry":{"path":"/applications/%1$s","renderer":"panels"},
             "declaration":{"names":{"en":"Panel trial"},"descriptions":{},"icon":"pages","groups":[]},
             "initialOpenEntryIds":[],"panelUses":[
               {"id":"trial","pageKey":"ontology-panels","panelId":"trial-panel","path":"/applications/%1$s/trial","names":{"en":"Trial"}},
               {"id":"other","pageKey":"other-page","panelId":"trial-panel","path":"/applications/%1$s/other","names":{"en":"Other"}}]}
            """.formatted(id);
    }

    @Test void startupKeepsTheBuiltinAndQuarantinesOnlyTheConflictingDomainUse() throws Exception {
        var operator = new QueryAccessService.GrantUser("operator", "trial-domain");
        when(identity.getCurrentUser()).thenReturn(operator);
        EntryAuthorizationFixture.allowEdit(authorization, operator, null);

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
        var roots = catalog.affectedEntryRoots("trial-domain", java.util.Set.of("trial-panel"));
        assertTrue(roots.stream().anyMatch(entry -> entry.entryId().equals(id + "/other")));
        assertFalse(catalog.ownsEntry("trial-domain", id + "/trial"));
        assertFalse(roots.stream().anyMatch(entry -> entry.entryId().equals(id + "/trial")));
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM sys_application WHERE id='app-new-trial'", Integer.class));
    }

    @Test void aBuiltinEntryResolvesTheSamePanelForTwoDomainsWithoutGrantRows() throws Exception {
        var actualCatalog = new ApplicationCatalog(jdbc,
            new TransactionTemplate(new DataSourceTransactionManager(dataSource)), access, "{}", panels, grants, authorization);
        actualCatalog.builtins("data-engine", List.of(builtInBrowser("builtin-product-browser")));
        var first = new QueryAccessService.GrantUser("one", "domain-one");
        var second = new QueryAccessService.GrantUser("two", "domain-two");
        var mvc = MockMvcBuilders.standaloneSetup(new ApplicationController(actualCatalog, identity,
            new WorkbenchServiceAuthentication("test-service"))).setControllerAdvice(new ApplicationErrors()).build();
        var request = get("/platform/applications/resolve-entry").param("path", "/browser/data");
        for (var reader : List.of(first, second)) {
            when(identity.getCurrentUser()).thenReturn(reader);
            mvc.perform(request).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.applicationId").value("browser"))
                .andExpect(jsonPath("$.data.use.panelId").value("builtin-product-browser"))
                .andExpect(jsonPath("$.data.use.id").value("browse"));
        }
        deniedEntries.add("two:browser/browse");
        mvc.perform(request).andExpect(status().isForbidden());
        assertNull(jdbc.queryForObject("SELECT to_regclass('public.product_grant')::text", String.class));
        verifyNoInteractions(panels);

        var localUse = new ApplicationPanelUse("local", "local", "builtin-product-browser", "/applications/app-local/home", null, Map.of("en", "Home"));
        var registration = new ApplicationController.PanelRegistration(
            new ApplicationController.PanelEntry("/applications/app-local", "panels"), List.of(localUse),
            builtin("local", "native").declaration(), List.of());
        actualCatalog.putPanelUses("app-local", registration, second);
        assertEquals("builtin-product-browser",
            actualCatalog.require("app-local").getList("panelUses", ApplicationPanelUse.class).getFirst().panelId());
        verify(panels).requireUsableRegistration("domain-two", null, List.of(localUse), null, null, "pages", null);
    }

    private ApplicationCatalog.Builtin builtInBrowser(String panelId) {
        var use = new ApplicationPanelUse("browse", "browse", panelId, "/browser/data", null, Map.of("en", "Browse"));
        var metadata = builtin("browser", "native").declaration();
        var declaration = new ApplicationCatalog.Declaration(metadata.names(), metadata.descriptions(), metadata.icon(),
            metadata.groups(), List.of(use));
        return new ApplicationCatalog.Builtin("browser", "native", "apps", "build", 1,
            JSONObject.of("path", "/browser", "renderer", "panels"), null, declaration);
    }

    @Test void aBuiltinCannotBorrowAnotherBuiltinsEntryAdmission() throws Exception {
        catalog.builtins("data-engine", List.of(builtin("first", "native"), builtin("other", "native")));
        var viewer = new QueryAccessService.GrantUser("viewer", "domain");
        when(identity.getCurrentUser()).thenReturn(viewer);
        deniedEntries.add("viewer:other/main");

        var route = "/platform/applications/resolve-entry";
        http.perform(get(route).param("applicationId", "first").param("useId", "main"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.applicationId").value("first"));
        http.perform(get(route).param("applicationId", "other").param("useId", "main"))
            .andExpect(status().isForbidden());
        http.perform(get(route).param("applicationId", "other").param("useId", "missing"))
            .andExpect(status().isNotFound());
    }

    @Test void managementRetainsFullUsesAndResolveReturnsTheSavedEntrySettings() throws Exception {
        var owner = new QueryAccessService.GrantUser("author", "domain");
        var viewer = new QueryAccessService.GrantUser("viewer", "domain");
        when(identity.getCurrentUser()).thenReturn(owner);
        EntryAuthorizationFixture.allowEdit(authorization, owner, null);
        var path = "/platform/applications/app-school/panel-uses";
        http.perform(put(path).contentType(MediaType.APPLICATION_JSON).content("""
            {"entry":{"path":"/applications/app-school","renderer":"panels"},"initialOpenEntryIds":[],
             "declaration":{"names":{"en":"School"},"descriptions":{},"icon":"school",
               "groups":[{"key":"school","names":{"en":"School"},"sort":1}]},
             "framePanelId":"panel-frame","theme":{"light":{"--el-color-primary":"#123456"}},
             "delivery":{"panels":["panel-frame","panel-school"],"projections":["projection-school"],"packages":[],"agents":[],"skills":[]},
             "panelUses":[
               {"id":"school","pageKey":"school","panelId":"panel-school","path":"/applications/app-school/main",
                "names":{"en":"School"},"groupKey":"school","inputs":{"term":{"literal":null}}},
               {"id":"private","names":{"en":"Private"},"inMenu":false,"pageKey":"private","panelId":"panel-school","path":"/applications/app-school/private"}]}
            """)).andExpect(status().isOk());

        http.perform(get(path).param("purpose", "management")).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.panelUses.length()").value(2))
            .andExpect(jsonPath("$.data.framePanelId").value("panel-frame"))
            .andExpect(jsonPath("$.data.delivery.projections[0]").value("projection-school"));
        http.perform(get(CATALOGUE + "/app-school")).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.panelUses[0].id").value("school"))
            .andExpect(jsonPath("$.data.panelUses[1].id").value("private"));

        var form = http.perform(post(CATALOGUE + "/form").locale(Locale.SIMPLIFIED_CHINESE)
                .contentType(MediaType.APPLICATION_JSON).content("""
                    {"section":"entries","target":{"kind":"object","objectType":"platform:Application","primaryKey":"app-school"}}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.values.panelUses[0].names.en").value("School"))
            .andExpect(jsonPath("$.data.values.panelUses[1].names.en").value("Private"))
            .andExpect(jsonPath("$.data.values.panelUses[1].inMenu").value(false))
            .andExpect(jsonPath("$.data.values.panelUses[1].descriptions").doesNotHaveJsonPath())
            .andReturn().getResponse().getContentAsString();
        var rowFields = JSON.parseObject(form).getJSONObject("data").getJSONArray("fields").getJSONObject(1)
            .getJSONObject("control").getJSONArray("itemFields").toJavaList(JSONObject.class);
        for (var fieldPath : List.of("/names", "/descriptions")) {
            var field = rowFields.stream().filter(item -> fieldPath.equals(item.getString("path"))).findFirst().orElseThrow();
            var control = field.getJSONObject("control");
            assertEquals("localized-text", control.getString("kind"));
            assertEquals("zh-CN", control.getString("primaryLocale"));
            assertEquals(List.of(), control.getList("requiredLocales", String.class));
            assertEquals("/names".equals(fieldPath), field.getBooleanValue("required"));
        }
        var inputsField = rowFields.stream().filter(item -> "/inputs".equals(item.getString("path"))).findFirst().orElseThrow();
        assertTrue(inputsField.getBooleanValue("advanced"));
        assertEquals("code", inputsField.getJSONObject("control").getString("kind"));
        assertTrue(rowFields.stream().noneMatch(item -> "/access".equals(item.getString("path"))));
        var defaultAgent = rowFields.stream().filter(item -> "/defaultAgent".equals(item.getString("path"))).findFirst().orElseThrow();
        assertFalse(defaultAgent.getBooleanValue("required"));
        assertEquals(JSONObject.of("kind", "select", "options", List.of()), defaultAgent.getJSONObject("control"));
        deniedEntries.add("viewer:app-school/private");
        when(identity.getCurrentUser()).thenReturn(viewer);
        http.perform(get(path).param("purpose", "management")).andExpect(status().isForbidden());
        http.perform(get(path)).andExpect(status().isOk()).andExpect(jsonPath("$.data.panelUses.length()").value(1));
        var resolve = "/platform/applications/resolve-entry";
        var byPath = http.perform(get(resolve).param("path", "/applications/app-school/main"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.framePanelId").value("panel-frame"))
            .andExpect(jsonPath("$.data.theme.light['--el-color-primary']").value("#123456"))
            .andExpect(jsonPath("$.data.use.inputs.term.literal").hasJsonPath())
            .andExpect(jsonPath("$.data.menu.names.en").value("School"))
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
            .andExpect(jsonPath("$.data.entryAccess").doesNotHaveJsonPath());

    }

    @Test void changingOnlyEntryInputsEmitsItsBoundRoot() throws Exception {
        var author = new QueryAccessService.GrantUser("author", "domain");
        when(identity.getCurrentUser()).thenReturn(author);
        EntryAuthorizationFixture.allowEdit(authorization, author, null);
        var path = "/platform/applications/app-root-inputs/panel-uses";
        var registration = """
            {"entry":{"path":"/applications/app-root-inputs","renderer":"panels"},"initialOpenEntryIds":[],
             "declaration":{"names":{"en":"Root inputs"},"descriptions":{},"icon":"pages","groups":[]},
             "framePanelId":"panel-shared","panelUses":[
               {"id":"main","names":{"en":"Main"},"pageKey":"root-inputs","panelId":"panel-shared","path":"/applications/app-root-inputs",
                "inputs":{"value":{"literal":null}}}]}
            """;
        http.perform(put(path).contentType(MediaType.APPLICATION_JSON).content(registration)).andExpect(status().isOk());
        var events = new ApplicationEntryEvents(jdbc);
        var first = events.read(0, 10);
        var updated = registration.replace("\"literal\":null", "\"literal\":1.25");
        http.perform(put(path).contentType(MediaType.APPLICATION_JSON).content(updated)).andExpect(status().isOk());

        var next = events.read(Long.parseLong(first.nextCursor()), 10);
        assertEquals(1, next.events().size());
        var changed = assertInstanceOf(ApplicationEntryEvents.Event.class, next.events().getFirst());
        assertEquals("app-root-inputs/main", changed.entryId());
        assertEquals(changed.before().panelIds(), changed.after().panelIds());
        var previousBinding = changed.before().boundPanelRoot().inputs().get("value");
        assertTrue(previousBinding.containsKey("literal"));
        assertNull(previousBinding.get("literal"));
        assertEquals(new java.math.BigDecimal("1.25"), changed.after().boundPanelRoot().inputs().get("value").get("literal"));
        assertTrue(changed.after().boundPanelRoot().alsoUnbound());

        http.perform(put(path).contentType(MediaType.APPLICATION_JSON).content(updated)).andExpect(status().isOk());
        assertTrue(events.read(Long.parseLong(next.nextCursor()), 10).events().isEmpty());
    }

    private static final String CATALOGUE = "/platform/applications/catalogue";
    private static final String CATALOGUE_APP = "/platform/applications/app-catalogue/panel-uses";
    private static final String CATALOGUE_REGISTRATION = """
        {"entry":{"path":"/applications/app-catalogue","renderer":"panels"},"initialOpenEntryIds":[],
         "declaration":{"names":{"en":"Catalogue demo","zh-CN":"目录示例"},"descriptions":{"en":"Find me"},"icon":"pages",
          "groups":[]},
         "panelUses":[
          {"id":"public","names":{"en":"Public"},"pageKey":"public","panelId":"panel-public","path":"/applications/app-catalogue/public"},
          {"id":"hidden","names":{"en":"Hidden"},"inMenu":false,"pageKey":"hidden","panelId":"panel-hidden","path":"/applications/app-catalogue/hidden"}]}
        """;

    @Test void catalogueNameOrderUsesReaderLanguageAndPagesAcrossEqualNames() throws Exception {
        var owner = new QueryAccessService.GrantUser("owner", "domain");
        when(identity.getCurrentUser()).thenReturn(owner);
        EntryAuthorizationFixture.allowEdit(authorization, owner, null);
        for (var id : List.of("app-a", "app-b", "app-c", "app-d"))
            publishFixture(id, builtin(id, "native").declaration(), owner);
        jdbc.update("""
            UPDATE sys_application SET names = CASE id
                WHEN 'app-a' THEN '{"en":"Alpha","fr":"Zulu"}'::jsonb
                WHEN 'app-d' THEN '{"en":"Alpha","fr":"Bravo"}'::jsonb
                ELSE '{"en":"Bravo"}'::jsonb
            END
            """);

        var first = cataloguePage(get(CATALOGUE).locale(Locale.FRENCH).param("sort", "name").param("size", "2"));
        assertEquals(List.of("app-b", "app-c"), catalogueIds(first));
        var cursor = first.getString("nextCursor");
        assertNotNull(cursor);
        var second = cataloguePage(get(CATALOGUE).locale(Locale.FRENCH)
            .param("sort", "name").param("size", "2").param("cursor", cursor));
        assertEquals(List.of("app-d", "app-a"), catalogueIds(second));
        assertFalse(second.containsKey("nextCursor"));
    }

    @Test void catalogueUpdatedOrderPagesByDescendingTimestampThenId() throws Exception {
        var owner = new QueryAccessService.GrantUser("owner", "domain");
        when(identity.getCurrentUser()).thenReturn(owner);
        EntryAuthorizationFixture.allowEdit(authorization, owner, null);
        for (var id : List.of("app-a", "app-b", "app-c"))
            publishFixture(id, builtin(id, "native").declaration(), owner);
        jdbc.update("UPDATE sys_application SET updated_at = '2026-01-01 00:00:00+00' WHERE id = 'app-a'");
        jdbc.update("UPDATE sys_application SET updated_at = '2026-01-01 00:00:00.000001+00' WHERE id IN ('app-b','app-c')");

        var first = cataloguePage(get(CATALOGUE).param("sort", "updated").param("size", "1"));
        assertEquals(List.of("app-b"), catalogueIds(first));
        var cursor = first.getString("nextCursor");
        assertNotNull(cursor);
        var second = cataloguePage(get(CATALOGUE).param("sort", "updated").param("cursor", cursor));
        assertEquals(List.of("app-c", "app-a"), catalogueIds(second));
        assertFalse(second.containsKey("nextCursor"));
    }

    private JSONObject cataloguePage(MockHttpServletRequestBuilder request) throws Exception {
        var result = http.perform(request).andExpect(status().isOk()).andReturn();
        return JSON.parseObject(result.getResponse().getContentAsString()).getJSONObject("data");
    }

    private List<String> catalogueIds(JSONObject page) {
        return page.getJSONArray("rows").toJavaList(JSONObject.class).stream().map(row -> row.getString("id")).toList();
    }

    @Test void catalogueReadsDifferFromNavigationAndKeepsAnAuthorizedEditorsCompleteEntryTable() throws Exception {
        var owner = new QueryAccessService.GrantUser("owner", "domain");
        var reader = new QueryAccessService.GrantUser("reader", "domain");
        var foreign = new QueryAccessService.GrantUser("foreign", "another-domain");
        when(identity.getCurrentUser()).thenReturn(owner);
        EntryAuthorizationFixture.allowEdit(authorization, owner, null);
        catalog.builtins("data-engine", List.of(builtin("browser", "native")));
        publishFixture("app-hosted", builtin("hosted", "native").declaration(), owner);
        publishFixture("app-private-foreign", builtin("foreign", "native").declaration(), foreign);
        http.perform(put(CATALOGUE_APP).contentType(MediaType.APPLICATION_JSON).content(CATALOGUE_REGISTRATION))
            .andExpect(status().isOk());

        deniedEntries.add("owner:browser/main");
        deniedEntries.add("owner:app-catalogue/hidden");
        deniedEntries.add("reader:app-catalogue/hidden");
        http.perform(get(CATALOGUE).param("countOnly", "true"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(2))
            .andExpect(jsonPath("$.data.rows").doesNotHaveJsonPath());
        deniedEntries.add("owner:app-hosted/main");
        http.perform(get("/platform/applications").param("purpose", "navigation"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.length()").value(1));
        http.perform(get("/platform/applications").param("purpose", "navigation").param("countOnly", "true"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1));
        http.perform(get(CATALOGUE).param("scope", "maintainable").param("size", "1"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.rows[0].id").value("app-catalogue"))
            .andExpect(jsonPath("$.data.rows[0].source").value("domain"))
            .andExpect(jsonPath("$.data.rows[0].canMaintain").value(true))
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
            .andExpect(jsonPath("$.data.entryAccess").doesNotHaveJsonPath());
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
        http.perform(get(CATALOGUE).param("countOnly", "true"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(3))
            .andExpect(jsonPath("$.data.rows").doesNotHaveJsonPath());
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
                                              "groups":[{"key":"tools","names":{"en":"Tools","zh-CN":"工具"},"sort":7}]},
                               "entry":{"path":"/applications/app-translated","renderer":"panels"},
                               "initialOpenEntryIds":[],"panelUses":[]}}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.fields[0].label").value("应用身份"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[0].label").value("名称"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[0].help").isNotEmpty())
            .andExpect(jsonPath("$.data.fields[0].control.fields[0].control.kind").value("localized-text"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[0].control.primaryLocale").value("zh-CN"))
            .andExpect(jsonPath("$.data.fields[0].control.fields[0].control.requiredLocales").isEmpty())
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
        EntryAuthorizationFixture.allowEdit(authorization, owner, null);

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
        values.put("initialOpenEntryIds", List.of("unknown"));
        http.perform(post(CATALOGUE + "/form").contentType(MediaType.APPLICATION_JSON)
                .content(JSONObject.of("section", "create", "target", JSONObject.of("kind", "draft", "id", id), "values", values).toJSONString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.errors[0].field").value("/initialOpenEntryIds"));
        values.put("initialOpenEntryIds", List.of());
        http.perform(put(saved).contentType(MediaType.APPLICATION_JSON).content(values.toJSONString()))
            .andExpect(status().isOk());
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

        // A reader in a non-English locale can create an application with only their locale's name (no English required).
        var zhForm = http.perform(post(CATALOGUE + "/form").locale(Locale.SIMPLIFIED_CHINESE)
                .contentType(MediaType.APPLICATION_JSON).content("""
                    {"section":"create","target":{"kind":"draft"},"changedField":null}
                    """)).andExpect(status().isOk()).andReturn();
        var zhData = JSONObject.parseObject(zhForm.getResponse().getContentAsString()).getJSONObject("data");
        var zhSave = zhData.getJSONObject("save").getString("path");
        var zhValues = zhData.getJSONObject("values");
        var zhId = zhValues.getJSONObject("entry").getString("path").substring("/applications/".length());
        var zhDecl = zhValues.getJSONObject("declaration");
        // Empty names map is still refused on /declaration/names.
        http.perform(post(CATALOGUE + "/form").locale(Locale.SIMPLIFIED_CHINESE)
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSONObject.of("section", "create", "target", JSONObject.of("kind", "draft", "id", zhId), "values", zhValues).toJSONString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.errors[0].field").value("/declaration/names"));
        zhDecl.getJSONObject("names").put("zh-CN", "中文应用");
        zhDecl.put("groups", List.of(JSONObject.of("key", "main", "names", JSONObject.of("zh-CN", "主菜单"), "sort", 0)));
        http.perform(post(CATALOGUE + "/form").locale(Locale.SIMPLIFIED_CHINESE)
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSONObject.of("section", "create", "target", JSONObject.of("kind", "draft", "id", zhId), "values", zhValues).toJSONString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.errors").isEmpty());
        http.perform(put(zhSave).contentType(MediaType.APPLICATION_JSON).content(zhValues.toJSONString()))
            .andExpect(status().isOk());
        http.perform(get(CATALOGUE).param("sort", "name").locale(Locale.ENGLISH))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.rows[?(@.id=='" + zhId + "')].names['zh-CN']").value("中文应用"));
    }

    @Test void resolvesNativePanelEntriesAndTheirMenusWithDefaultPlatformFrameAndInputsWithoutTheme() throws Exception {
        var declared = builtin("native-frame-demo", "native");
        var use = new ApplicationPanelUse("overview", "native-frame-demo-overview", "builtin-product-overview",
            "/native-frame-demo/overview", null,
            Map.of("en", "Overview"), Map.of("en", "Explain the overview"),
            Map.of("term", Map.of("literal", "autumn")), "main");
        var metadata = new ApplicationCatalog.Declaration(Map.of("en", "Native example"), Map.of(), "pages",
            List.of(new ApplicationCatalog.Group("main", Map.of("en", "Main"), 1)), List.of(use));
        catalog.builtins("data-engine", List.of(new ApplicationCatalog.Builtin(declared.id(), declared.kind(),
            declared.rail(), declared.category(), declared.sort(), declared.entry(),
            declared.scheduleAdapter(), metadata)));
        jdbc.update("UPDATE sys_application SET panel_settings=?::jsonb WHERE id=?", """
            {"framePanelId":"stale-frame","theme":{"light":{"--el-color-primary":"#123456"}}}
            """, declared.id());
        var viewer = new QueryAccessService.GrantUser("viewer", "domain");
        when(identity.getCurrentUser()).thenReturn(viewer);

        var route = "/platform/applications/resolve-entry";
        var byPath = http.perform(get(route).param("path", use.path()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.framePanelId").value(ApplicationCatalog.DEFAULT_FRAME_PANEL_ID))
            .andExpect(jsonPath("$.data.theme").doesNotHaveJsonPath())
            .andExpect(jsonPath("$.data.use.inputs.term.literal").value("autumn"))
            .andExpect(jsonPath("$.data.use.descriptions.en").value("Explain the overview"))
            .andExpect(jsonPath("$.data.menu.names.en").value("Native example"))
            .andExpect(jsonPath("$.data.menu.groups[0].key").value("main"))
            .andExpect(jsonPath("$.data.menu.panelUses[0].id").value("overview"))
            .andExpect(jsonPath("$.data.menu.panelUses[0].inputs.term.literal").value("autumn"))
            .andReturn().getResponse().getContentAsString();
        var byUse = http.perform(get(route).param("applicationId", declared.id()).param("useId", use.id()))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertEquals(JSON.parseObject(byPath), JSON.parseObject(byUse));
        assertEquals(use, catalog.require(declared.id()).getList("panelUses", ApplicationPanelUse.class).getFirst());
    }

    @Test void validatesOnlyNewAndChangedIconsWhilePreservingLegacyIcons() throws Exception {
        var owner = new QueryAccessService.GrantUser("owner", "domain");
        when(identity.getCurrentUser()).thenReturn(owner);
        EntryAuthorizationFixture.allowEdit(authorization, owner, null);
        var path = "/platform/applications/app-icon-proof/panel-uses";
        var registration = JSON.parseObject("""
            {"entry":{"path":"/applications/app-icon-proof","renderer":"panels"},"initialOpenEntryIds":[],
             "declaration":{"names":{"en":"Original"},"descriptions":{},"icon":"pages","groups":[]},
             "panelUses":[]}
            """);
        http.perform(put(path).contentType(MediaType.APPLICATION_JSON).content(registration.toJSONString()))
            .andExpect(status().isOk());
        verify(panels).requireUsableRegistration(eq("domain"), isNull(), eq(List.of()), isNull(), isNull(), eq("pages"), any(Locale.class));
        jdbc.update("UPDATE sys_application SET icon=? WHERE id=?", "ontology", "app-icon-proof");
        var declaration = registration.getJSONObject("declaration");
        declaration.put("icon", "ontology");
        declaration.put("names", JSONObject.of("en", "Renamed"));
        clearInvocations(panels);
        http.perform(put(path).contentType(MediaType.APPLICATION_JSON).content(registration.toJSONString()))
            .andExpect(status().isOk());
        verify(panels).requireUsableRegistration(eq("domain"), isNull(), eq(List.of()), isNull(), isNull(), isNull(), any(Locale.class));

        var identityPath = "/platform/applications/app-icon-proof/identity";
        var update = JSONObject.of("names", JSONObject.of("en", "Renamed again"), "descriptions", new JSONObject(), "icon", "ontology");
        clearInvocations(panels);
        http.perform(put(identityPath).contentType(MediaType.APPLICATION_JSON).content(update.toJSONString()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.icon").value("ontology"));
        verifyNoInteractions(panels);

        doThrow(ApplicationCatalog.bad("Icon is reserved")).when(panels)
            .requireCurrent("domain", null, List.of(), null, null, "settings", null);
        update.put("icon", "settings");
        http.perform(put(identityPath).contentType(MediaType.APPLICATION_JSON).content(update.toJSONString()))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("Icon is reserved"));
        assertEquals("ontology", catalog.require("app-icon-proof").getString("icon"));
    }

    @Test void registrationReportsARefusedDefaultAgentOnItsSubmittedEntryRow() throws Exception {
        var acceptLanguage = new AtomicReference<String>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var reason = "Entry 'history' default agent preset 'knowledge-governance' does not select the skill for panel 'panel-overview'.";
        var payload = JSONObject.of(
            "error", JSONObject.of("code", "PAGE_DEFAULT_AGENT_UNAVAILABLE", "message", reason),
            "details", JSONObject.of("useId", "history"));
        server.createContext("/internal/product-panels/validate-references", exchange -> {
            try {
                acceptLanguage.set(exchange.getRequestHeaders().getFirst(HttpHeaders.ACCEPT_LANGUAGE));
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
            var panelClient = new PanelResources("http://127.0.0.1:" + server.getAddress().getPort(), "test-service", identity);
            var remoteCatalog = new ApplicationCatalog(jdbc, new TransactionTemplate(new DataSourceTransactionManager(dataSource)),
                access, "{}", panelClient, grants, authorization);
            var mvc = MockMvcBuilders.standaloneSetup(new ApplicationController(remoteCatalog, identity,
                    new WorkbenchServiceAuthentication("test-service")))
                .setControllerAdvice(new ApplicationErrors())
                .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
            when(identity.getCurrentUser()).thenReturn(new QueryAccessService.GrantUser("owner", "domain"));

            mvc.perform(put("/platform/applications/app-default-agent-proof/panel-uses")
                    .param("create", "true").locale(Locale.SIMPLIFIED_CHINESE)
                    .contentType(MediaType.APPLICATION_JSON).content("""
                    {"entry":{"path":"/applications/app-default-agent-proof","renderer":"panels"},"initialOpenEntryIds":[],
                     "declaration":{"names":{"en":"Default agent proof"},"descriptions":{},"icon":"pages","groups":[]},
                     "panelUses":[
                       {"id":"overview","names":{"en":"Overview"},"pageKey":"overview-proof","panelId":"panel-overview",
                        "path":"/applications/app-default-agent-proof/overview"},
                       {"id":"history","names":{"en":"History"},"pageKey":"history-proof","panelId":"panel-overview",
                        "path":"/applications/app-default-agent-proof/history",
                        "defaultAgent":{"kind":"preset","agentKind":"knowledge-governance"}}]}
                    """)).andExpect(status().isConflict())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.code").value("PAGE_DEFAULT_AGENT_UNAVAILABLE"))
                .andExpect(jsonPath("$.message").value(reason))
                .andExpect(jsonPath("$.errors[0].field").value("/values/panelUses/1/defaultAgent"))
                .andExpect(jsonPath("$.errors[0].code").value("target_unavailable"))
                .andExpect(jsonPath("$.errors[0].message").value(reason));
            assertEquals("zh-CN", acceptLanguage.get());
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
            var panelClient = new PanelResources("http://127.0.0.1:" + server.getAddress().getPort(), "test-service", identity);
            var remoteCatalog = new ApplicationCatalog(jdbc, new TransactionTemplate(new DataSourceTransactionManager(dataSource)),
                access, "{}", panelClient, grants, authorization);
            var mvc = MockMvcBuilders.standaloneSetup(new ApplicationController(remoteCatalog, identity,
                    new WorkbenchServiceAuthentication("test-service")))
                .setControllerAdvice(new ApplicationErrors())
                .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
            when(identity.getCurrentUser()).thenReturn(new QueryAccessService.GrantUser("owner", "domain"));

            var body = """
                {"entry":{"path":"/applications/app-native-settings","renderer":"panels"},"initialOpenEntryIds":[],
                 "declaration":{"names":{"en":"Settings"},"descriptions":{},"icon":"pages","groups":[]},
                 "panelUses":[{"id":"overview","names":{"en":"Overview"},"pageKey":"frame-demo-overview","panelId":"panel-overview",
                   "path":"/applications/app-native-settings/overview",
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
            var remote = new PanelResources("http://127.0.0.1:" + server.getAddress().getPort(), "test-service", identity);

            when(identity.getCurrentUser()).thenReturn(new QueryAccessService.GrantUser("registrant", "domain"));
            RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
            remote.requireUsableRegistration("domain", null, List.of(
                new ApplicationPanelUse("report", "report", "panel-report", "/example/report",
                    new DefaultAgentTarget("preset", null, "knowledge-governance"), Map.of("en", "Report"),
                    null, null, null, null, null, null, false),
                new ApplicationPanelUse("plan", "plan", "panel-plan", "/example/plan",
                    new DefaultAgentTarget("id", "planner", null), Map.of("en", "Plan"),
                    null, null, null, null, null, null, false),
                new ApplicationPanelUse("ordinary", "ordinary", "panel-ordinary", "/example/ordinary", null, Map.of("en", "Ordinary"),
                    null, null, null, null, null, null, false)
            ), null, null, null, null);

            assertEquals("test-service", serviceHeader.get());
            var uses = requests.get().getJSONArray("uses");
            assertEquals(JSONObject.of("kind", "preset", "agentKind", "knowledge-governance"),
                uses.getJSONObject(0).getJSONObject("defaultAgent"));
            assertEquals(JSONObject.of("kind", "id", "id", "planner"), uses.getJSONObject(1).getJSONObject("defaultAgent"));
            assertFalse(uses.getJSONObject(2).containsKey("defaultAgent"));
        } finally {
            RequestContextHolder.resetRequestAttributes();
            server.stop(0);
        }
    }

    @Test void mergesEditionBuiltinEntriesAndAdmitsNativeEntriesWithoutPanelGrantsOrSkills() throws Exception {
        var editionAuth = new ApplicationPanelUse("authorization", "authorization", null,
            "/settings/system-config/authorization",
            null, Map.of("en", "License"), null, null, "system-settings", "key-round", ApplicationPanelUse.NATIVE_KIND);
        when(access.builtinEntries("settings")).thenReturn(List.of(editionAuth));

        var settings = ApplicationCatalogUpgrade.Builtins.readDeclaration(new ClassPathResource("applications/settings.json"));
        catalog.builtins("data-engine", List.of(settings));

        var user = new QueryAccessService.GrantUser("admin", "domain-a");
        for (var use : settings.declaration().panelUses()) {
            if (use.panelEntry() && !"audit-log".equals(use.id())) {
                deniedEntries.add(user.getId() + ":settings/" + use.id());
            }
        }
        // Visible catalog includes admitted panel + both native entries (system-monitor & edition-merged authorization).
        var view = catalog.view(catalog.require("settings"), user);
        assertFalse(view.getBooleanValue("singleEntry"));
        var visibleUses = view.getList("panelUses", ApplicationPanelUse.class);
        assertEquals(List.of("audit-log", "system-monitor", "authorization"),
            visibleUses.stream().map(ApplicationPanelUse::id).toList());

        // Resolving a panel entry returns the full menu including admitted native entries.
        var resolved = catalog.resolveEntry("/settings/records/audit-log", user);
        var menu = (ApplicationCatalog.EntryMenu) resolved.get("menu");
        assertFalse(menu.singleEntry());
        assertEquals(List.of("audit-log", "system-monitor", "authorization"),
            menu.panelUses().stream().map(ApplicationPanelUse::id).toList());

        // Native entries have their own admission and never expose panel operation placement.
        assertTrue(catalog.resolveEntry("/settings/records/system-monitor", user)
            .getObject("use", ApplicationPanelUse.class).nativeEntry());
        assertTrue(catalog.resolveEntry("/settings/system-config/authorization", user)
            .getObject("use", ApplicationPanelUse.class).nativeEntry());
    }

}

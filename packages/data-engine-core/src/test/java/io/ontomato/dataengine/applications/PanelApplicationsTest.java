package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

class PanelApplicationsTest {
    private static final PageSkills.Skill LEGACY_SKILL = new PageSkills.Skill(new PageSkills.Namespace("provider", "ontology", null), "knowledge-governance");
    private final JdbcTemplate db = mock(JdbcTemplate.class);
    private final TransactionTemplate tx = mock(TransactionTemplate.class);
    private final ApplicationAccess access = mock(ApplicationAccess.class);
    private final PanelResources panels = mock(PanelResources.class);
    private final ProductGrantService grants = mock(ProductGrantService.class);
    private final User user = mock(User.class);
    private final ApplicationCatalog catalog;

    PanelApplicationsTest() {
        when(user.getId()).thenReturn("author"); when(user.getDomainId()).thenReturn("domain");
        when(tx.execute(any())).thenAnswer(call -> ((TransactionCallback<?>)call.getArgument(0)).doInTransaction(null));
        when(grants.allowed(anyString(), eq("use"))).thenReturn(true);
        catalog = spy(new ApplicationCatalog(db, tx, access, "{}", panels, grants));
        doReturn(List.of()).when(catalog).all();
    }
    private static ApplicationPanelUse use(String page, String permission) {
        return use("app-panel-a", page, permission);
    }
    private static ApplicationPanelUse use(String application, String page, String permission) {
        return new ApplicationPanelUse("use-" + page, page, "panel-p", "/applications/" + application + "/" + page,
            permission == null ? new ApplicationPanelUse.Access(null, "domain-member") : new ApplicationPanelUse.Access(permission, null), null, null);
    }
    private static ApplicationCatalog.Declaration metadata() {
        return new ApplicationCatalog.Declaration(Map.of("en", "Example"), Map.of(), "calendar", List.of(), List.of(), List.of(), List.of());
    }
    private static JSONObject app(String id, String renderer, List<ApplicationPanelUse> uses) {
        return JSONObject.of("id", id, "domainId", "domain", "ownerUserId", "author",
            "entry", JSONObject.of("renderer", renderer, "path", renderer.equals("panels") ? "/applications/" + id : "/" + id), "panelUses", uses,
            "pageSkills", List.of(), "entryAccess", List.of("domain-member"));
    }
    private static ApplicationController.PanelRegistration body(List<ApplicationPanelUse> uses, boolean create) {
        return body("app-panel-a", uses, create);
    }
    private static ApplicationController.PanelRegistration body(String application, List<ApplicationPanelUse> uses, boolean create) {
        return new ApplicationController.PanelRegistration(new ApplicationController.PanelEntry("/applications/" + application, "panels"), uses,
            create ? metadata() : null, create ? List.of("domain-member") : null);
    }

    private static ApplicationPanelUse at(String page, String path) {
        return new ApplicationPanelUse("use-" + page, page, "panel-p", path,
            new ApplicationPanelUse.Access(null, "domain-member"), null, null);
    }

    private static ApplicationCatalog.Builtin builtin(String id, String path, ApplicationPanelUse use) {
        var declaration = new ApplicationCatalog.Declaration(Map.of("en", id), Map.of(), "calendar", List.of(),
            List.of(), List.of(), List.of(use));
        return new ApplicationCatalog.Builtin(id, "native", "apps", "admin", 1,
            JSONObject.of("renderer", "panels", "path", path), List.of("domain-member"), null, declaration);
    }

    @Test void rejectsDomainPathsOutsideTheAssignedSpaceAndNormalizedDuplicatesWithoutWrites() {
        for (var path : List.of("/ontology/agents", "/applications/app-panel-b/tasks", "/applications/app-panel-ab/tasks",
            "/applications/app-panel-a/%2e%2e/app-panel-b/tasks", "/applications/app-panel-a/%2Ftasks",
            "/applications/app-panel-a/tasks?state={}")) {
            assertThrows(ResponseStatusException.class, () -> catalog.putPanelUses("app-panel-a", body(List.of(at("tasks", path)), true), user));
        }
        var widened = new ApplicationController.PanelRegistration(new ApplicationController.PanelEntry("/ontology", "panels"),
            List.of(at("agents", "/ontology/agents")), metadata(), List.of("domain-member"));
        assertThrows(ResponseStatusException.class, () -> catalog.putPanelUses("app-panel-a", widened, user));
        var aliases = List.of(at("tasks", "/applications/app-panel-a/tasks"), at("alias", "/applications/app-panel-a/%74asks/"));
        assertThrows(ResponseStatusException.class, () -> catalog.putPanelUses("app-panel-a", body(aliases, true), user));
        verifyNoInteractions(db, panels, grants, access);
    }

    @Test void onlyTrustedDeclarationsCanUseAnExplicitBuiltinPathAndItCannotBeClaimedTwice() {
        doAnswer(call -> {
            call.<java.util.function.Consumer<org.springframework.transaction.TransactionStatus>>getArgument(0).accept(null);
            return null;
        }).when(tx).executeWithoutResult(any());
        var ontology = app("ontology", "panels", List.of(at("settings", "/ontology/agents")));
        ontology.put("domainId", null);
        ontology.put("kind", "native");
        ontology.put("ownerService", "data-engine");
        doReturn(ontology).when(catalog).require("ontology");
        catalog.builtins("data-engine", List.of(builtin("ontology", "/ontology", at("settings", "/ontology/agents"))));
        doReturn(List.of(ontology)).when(catalog).all();
        assertEquals("/ontology/agents", catalog.panelSkillSources("domain").getFirst().uses().getFirst().path());

        assertThrows(ResponseStatusException.class, () ->
            catalog.builtins("workbench", List.of(builtin("agents", "/agents", at("other", "/ontology/agents/")))));
        assertThrows(ResponseStatusException.class, () ->
            catalog.builtins("workbench", List.of(builtin("agents", "/agents", at("other", "/applications/app-other/tasks")))));

        var builtinWithDomainStyleId = app("app-panel-a", "panels", List.of());
        builtinWithDomainStyleId.put("domainId", null);
        doReturn(List.of(builtinWithDomainStyleId)).when(catalog).all();
        var refusal = assertThrows(ResponseStatusException.class, () ->
            catalog.putPanelUses("app-panel-a", body(List.of(use("tasks", null)), false), user));
        assertEquals(403, refusal.getStatusCode().value());
    }

    @Test void theApplicationGalleryKeepsTheBareApplicationsPathBesideAssignedPanelApplications() {
        doAnswer(call -> {
            call.<java.util.function.Consumer<org.springframework.transaction.TransactionStatus>>getArgument(0).accept(null);
            return null;
        }).when(tx).executeWithoutResult(any());
        var galleryEntry = JSONObject.of("renderer", "application-gallery", "path", "/applications", "home", "/applications");
        var gallery = JSONObject.of("id", "application-gallery", "kind", "native", "ownerService", "workbench",
            "entry", galleryEntry, "panelUses", List.of(), "pageSkills", List.of(), "entryAccess", List.of("domain-member"));
        gallery.put("domainId", null);
        doReturn(gallery).when(catalog).require("application-gallery");
        var declaration = new ApplicationCatalog.Declaration(Map.of("en", "Application gallery"), Map.of(), "gallery", List.of(),
            List.of(), List.of(), List.of());
        catalog.builtins("workbench", List.of(new ApplicationCatalog.Builtin("application-gallery", "native", "top", "business", 2,
            galleryEntry, List.of("domain-member"), null, declaration)));
        assertThrows(ResponseStatusException.class, () ->
            catalog.builtins("workbench", List.of(builtin("gallery-child", "/applications/gallery-child", at("x", "/applications/gallery-child/x")))));

        var trial = app("app-panel-a", "panels", List.of());
        doReturn(List.of(gallery, trial)).when(catalog).all();
        when(access.canMaintain(trial, user)).thenReturn(true);
        var response = catalog.putPanelUses("app-panel-a", body(List.of(use("tasks", null)), false), user);
        assertEquals("/applications/app-panel-a/tasks", response.getList("panelUses", ApplicationPanelUse.class).getFirst().path());
    }

    @Test void oldTrialPathsFailTheDirectReadAndDoNotBlockAnotherTrialBeingReRegistered() throws Exception {
        var trialA = app("app-panel-a", "panels", List.of(at("a", "/tasks")));
        var trialB = app("app-panel-b", "panels", List.of(at("b", "/summary")));
        doReturn(List.of(trialA, trialB)).when(catalog).all();
        when(access.canEnter(trialA, user)).thenReturn(true);
        when(access.canMaintain(trialA, user)).thenReturn(true);
        var identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(user);
        var mvc = MockMvcBuilders.standaloneSetup(new ApplicationController(catalog, identity, mock(WorkbenchServiceAuthentication.class)))
            .setControllerAdvice(new ApplicationErrors()).build();

        mvc.perform(get("/platform/applications/app-panel-a/panel-uses"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("app-panel-a")));
        assertTrue(catalog.panelSkillSources("domain").isEmpty());
        assertTrue(catalog.visible(user).isEmpty());
        var response = catalog.putPanelUses("app-panel-a", body(List.of(use("a", null)), false), user);
        assertEquals("/applications/app-panel-a/a", response.getList("panelUses", ApplicationPanelUse.class).getFirst().path());
    }

    @Test void createsANewPanelsApplicationThroughTheRealJacksonHttpBoundaryWithoutPersistingPageSkills() throws Exception {
        var application = app("app-panel-a", "panels", List.of(use("schedules-a", null)));
        doReturn(application).when(catalog).require("app-panel-a");
        var identity = mock(IdentityService.class); when(identity.getCurrentUser()).thenReturn(user);
        var mvc = MockMvcBuilders.standaloneSetup(new ApplicationController(catalog, identity, mock(WorkbenchServiceAuthentication.class))).build();
        var result = mvc.perform(put("/platform/applications/app-panel-a/panel-uses").contentType(MediaType.APPLICATION_JSON).content("""
            {"entry":{"path":"/applications/app-panel-a/","renderer":"panels"},"entryAccess":["domain-member"],
             "declaration":{"names":{"en":"Example"},"descriptions":{},"icon":"calendar","groups":[],"permissions":[]},
             "panelUses":[{"id":"use-a","pageKey":"schedules-a","panelId":"panel-p","path":"/applications/app-panel-a/%73chedules-a/",
               "access":{"kind":"domain-member"},"defaultAgent":{"kind":"id","id":"preferred-agent"},"names":{"en":"Tasks","zh-CN":"任务"}}]}
            """)).andExpect(status().isOk()).andReturn();
        assertEquals("panels", JSONObject.parseObject(result.getResponse().getContentAsString()).getJSONObject("data").getJSONObject("entry").getString("renderer"));
        var savedUse = JSONObject.parseObject(result.getResponse().getContentAsString()).getJSONObject("data").getJSONArray("panelUses").getJSONObject(0);
        assertFalse(savedUse.containsKey("skill"));
        assertEquals("/applications/app-panel-a/schedules-a", savedUse.getString("path"));
        assertEquals("preferred-agent", savedUse.getJSONObject("defaultAgent").getString("id"));
        assertEquals("任务", savedUse.getJSONObject("names").getString("zh-CN"));
        var dashboard = new PageSkills.Mapping(null, "domain-member", "dashboard",
            new PageSkills.Skill(new PageSkills.Namespace("provider", "workbench", null), "dashboard-pages"), null);
        var legacy = app("dashboards", "dashboards", List.of()); legacy.put("pageSkills", List.of(dashboard));
        doReturn(List.of(application, legacy)).when(catalog).all();
        when(access.pageSkills(anyList(), eq(user))).thenAnswer(call -> call.getArgument(0));
        var projected = mvc.perform(get("/platform/page-skills")).andExpect(status().isOk()).andReturn();
        var projection = JSONObject.parseObject(projected.getResponse().getContentAsString()).getJSONObject("data");
        assertEquals(List.of("dashboard", "schedules-a"), projection.getJSONArray("pageSkills").toJavaList(JSONObject.class).stream().map(value -> value.getString("pageKey")).toList());
        var derived = catalog.panelSkillSources("domain").getFirst().skill();
        assertEquals(List.of("dashboard-pages", derived.name()), projection.getJSONArray("registeredSkills").toJavaList(JSONObject.class).stream().map(value -> value.getString("name")).toList());
        assertEquals(derived.name(), projection.getJSONArray("pageSkills").getJSONObject(1).getJSONObject("skill").getString("name"));
        verify(panels).requireCurrent("domain", List.of("panel-p"));
        var write = mockingDetails(db).getInvocations().stream().filter(call -> call.getMethod().getName().equals("update")).findFirst().orElseThrow();
        assertEquals("[]", write.getArgument(18));
        assertEquals("panel-p", com.alibaba.fastjson2.JSON.parseArray(write.<String>getArgument(19)).getJSONObject(0).getString("panelId"));
    }

    @Test void refusesAnExistingLegacyApplicationBeforeReferenceOrPermissionSideEffects() throws Exception {
        doReturn(List.of(app("app-existing", "native", List.of()))).when(catalog).all();
        var identity = mock(IdentityService.class); when(identity.getCurrentUser()).thenReturn(user);
        var mvc = MockMvcBuilders.standaloneSetup(new ApplicationController(catalog, identity, mock(WorkbenchServiceAuthentication.class))).build();
        mvc.perform(put("/platform/applications/app-existing/panel-uses").contentType(MediaType.APPLICATION_JSON)
            .content("{\"entry\":{\"path\":\"/existing\",\"renderer\":\"panels\"},\"panelUses\":[]}"))
            .andExpect(status().isBadRequest());
        verifyNoInteractions(db, panels, grants, access);
    }

    @Test void rejectsReferencesThatAreNotInTheCurrentPanelCollectionBeforeSaving() {
        doThrow(new ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST)).when(panels).requireCurrent("domain", List.of("panel-p"));
        assertThrows(ResponseStatusException.class, () -> catalog.putPanelUses("app-panel-a", body(List.of(use("schedules-a", null)), true), user));
        verifyNoInteractions(db);
    }

    @Test void requiresTheExistingPanelsApplicationMaintainerAndKeepsMetadataOnRelationOnlyUpdates() {
        var existing = app("app-panel-a", "panels", List.of()); doReturn(List.of(existing)).when(catalog).all();
        assertThrows(ResponseStatusException.class, () -> catalog.putPanelUses("app-panel-a", body(List.of(use("schedules-a", null)), false), user));
        verify(db, never()).update(anyString(), any(Object[].class));
        when(access.canMaintain(existing, user)).thenReturn(true);
        catalog.putPanelUses("app-panel-a", body(List.of(use("schedules-a", null)), false), user);
        verify(db).update(startsWith("UPDATE sys_application SET entry="), any(Object[].class));
        verify(access, never()).declare(any(), any(), anyBoolean());
    }

    @Test void validatesUseLocators() {
        var first = use("schedules-a", null); var second = use("schedules-b", null);
        assertDoesNotThrow(() -> ApplicationPanelUse.validate(List.of(first, second)));
        assertNotEquals(first.locator(), second.locator());
        assertDoesNotThrow(() -> ApplicationPanelUse.validate(List.of(use("form", "menu"), use("summary", "menu"))));
        assertThrows(ResponseStatusException.class, () -> ApplicationPanelUse.validate(List.of(first, first)));
    }

    @Test void keepsMemberLocatorsUniqueAcrossApplications() {
        doReturn(List.of(app("app-existing", "panels", List.of(use("app-existing", "schedules-a", null))))).when(catalog).all();
        assertThrows(ResponseStatusException.class, () -> catalog.putPanelUses("app-panel-a", body(List.of(use("schedules-a", null)), true), user));
        verify(db, never()).update(anyString(), any(Object[].class));
    }

    @Test void sharesOneDerivedSkillAcrossPanelsWithTheSameMenu() {
        var first = app("app-panel-a", "panels", List.of(use("schedules-a", "menu")));
        var second = app("app-panel-b", "panels", List.of(new ApplicationPanelUse("use-b", "schedules-b", "panel-q", "/applications/app-panel-b/tasks", new ApplicationPanelUse.Access("menu", null), new DefaultAgentTarget("id", "summary-agent", null), null)));
        doReturn(List.of(first)).when(catalog).all(); doReturn(second).when(catalog).require("app-panel-b");
        catalog.putPanelUses("app-panel-b", body("app-panel-b", second.getList("panelUses", ApplicationPanelUse.class), true), user);
        doReturn(List.of(first, second)).when(catalog).all();
        var source = catalog.panelSkillSources("domain").getFirst();
        assertEquals(List.of("panel-p", "panel-q"), source.uses().stream().map(PanelSkills.Use::panelId).toList());
        assertEquals("panel-menu-menu-c661d73dba966285774f9f15", source.skill().name());
        var mapping = new PageSkills.Mapping("menu", null, null, source.skill(),
            List.of(new PageSkills.Default("schedules-b", new DefaultAgentTarget("id", "summary-agent", null))));
        when(access.pageSkills(List.of(mapping), user)).thenReturn(List.of());
        assertEquals(new PageSkills.Projection(List.of(), List.of(source.skill()), List.of()), catalog.pageSkills(user));
        when(access.pageSkills(List.of(mapping), user)).thenReturn(List.of(mapping));
        assertEquals(new PageSkills.Projection(List.of(mapping), List.of(source.skill()), List.of()), catalog.pageSkills(user));
    }

    @Test void serviceCatalogProjectsThreeMemberSkillsFromTwoApplicationsAndIsolatesDomains() throws Exception {
        var a = app("app-panels-trial-a", "panels", List.of(use("app-panels-trial-a", "panels-trial-a-tasks", null)));
        var b = app("app-panels-trial-b", "panels", List.of(use("app-panels-trial-b", "panels-trial-b-tasks", null),
            new ApplicationPanelUse("use-q", "panels-trial-b-summary", "panel-q", "/applications/app-panels-trial-b/summary",
                new ApplicationPanelUse.Access(null, "domain-member"), null, null)));
        var foreign = app("app-foreign", "panels", List.of(use("app-foreign", "foreign-page", null)));
        foreign.put("domainId", "foreign");
        doReturn(List.of(a, b, foreign)).when(catalog).all();
        var identity = mock(IdentityService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new ApplicationController(catalog, identity, new WorkbenchServiceAuthentication("service-fixture"))).build();

        mvc.perform(get(ApplicationController.PANEL_SKILL_SOURCES).param("domainId", "domain")).andExpect(status().isForbidden());
        var request = get(ApplicationController.PANEL_SKILL_SOURCES).header(WorkbenchServiceAuthentication.HEADER, "service-fixture");
        mvc.perform(request.param("domainId", "domain"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(3))
            .andExpect(jsonPath("$.data[0].skill.namespace.domainId").value("domain"))
            .andExpect(jsonPath("$.data[0].uses[0].pageKey").value("panels-trial-a-tasks"))
            .andExpect(jsonPath("$.data[1].uses[0].pageKey").value("panels-trial-b-tasks"))
            .andExpect(jsonPath("$.data[2].uses[0].panelId").value("panel-q"));
        mvc.perform(get(ApplicationController.PANEL_SKILL_SOURCES)
                .header(WorkbenchServiceAuthentication.HEADER, "service-fixture").param("domainId", "foreign"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].uses[0].pageKey").value("foreign-page"));
        verifyNoInteractions(identity, access, grants);
        when(access.pageSkills(anyList(), eq(user))).thenAnswer(call -> call.getArgument(0));
        var sources = catalog.panelSkillSources("domain");
        assertEquals(List.of(
            "panel-page-panels-trial-a-tasks-5b8e580bfe498f76fd5b2f47",
            "panel-page-panels-trial-b-tasks-078cb1db044a707c17788b14",
            "panel-page-panels-trial-b-summary-bbb7128431ec0bc491e589e0"
        ), sources.stream().map(source -> source.skill().name()).toList());
        assertEquals(sources.stream().map(PanelSkills.Source::skill).toList(), catalog.pageSkills(user).registeredSkills());
    }

    @Test void skillNamesStayLegalAndDistinguishSimilarAndLongLocators() {
        var keys = List.of("Page:A", "page-a", "定时任务", "page-".repeat(39) + "a", "page-".repeat(39) + "b");
        var refs = keys.stream().map(key -> PanelSkills.identity("domain", use(key, null))).toList();
        assertEquals(keys.size(), refs.stream().distinct().count());
        for (var ref : refs) {
            assertTrue(ref.name().length() <= 64);
            assertTrue(ref.name().matches("[a-z0-9]+(?:-[a-z0-9]+)*"));
        }
    }

    @Test void refusesMixedLegacyAndPanelsRegistrationForTheSameMenuCode() {
        var legacy = app("app-existing", "native", List.of());
        legacy.put("pageSkills", List.of(new PageSkills.Mapping("menu", null, null, LEGACY_SKILL, null)));
        doReturn(List.of(legacy)).when(catalog).all();
        assertThrows(ResponseStatusException.class, () -> catalog.putPanelUses("app-panel-a", body(List.of(use("schedules-a", "menu")), true), user));
        verify(db, never()).update(anyString(), any(Object[].class));
    }

    @Test void deniesLegacyPublicationForAnAlreadyManagedPanelsApplication() {
        doReturn(List.of(app("app-panel-a", "panels", List.of()))).when(catalog).all();
        assertThrows(ResponseStatusException.class, () -> catalog.publishProduct("app-panel-a", metadata(), "release", user));
        verify(db, never()).update(anyString(), any(Object[].class));
    }

    @Test void navigationCatalogReusesPanelUseAccessAndKeepsItsNamesAndOrder() throws Exception {
        var named = new ApplicationPanelUse("use-named", "named", "panel-p", "/applications/app-panel-a/named",
            new ApplicationPanelUse.Access(null, "domain-member"), null, Map.of("en", "Tasks", "zh-CN", "任务"));
        var denied = new ApplicationPanelUse("use-denied", "denied", "panel-q", "/applications/app-panel-a/denied",
            new ApplicationPanelUse.Access("menu", null), null, Map.of("en", "Hidden"));
        var detail = use("detail", null);
        var declared = List.of(named, denied, detail);
        var application = app("app-panel-a", "panels", declared);
        doReturn(List.of(application)).when(catalog).all();
        when(access.canEnter(application, user)).thenReturn(true);
        when(access.panelUses(declared, user)).thenReturn(List.of(named, detail));
        var identity = mock(IdentityService.class); when(identity.getCurrentUser()).thenReturn(user);
        var mvc = MockMvcBuilders.standaloneSetup(new ApplicationController(catalog, identity, mock(WorkbenchServiceAuthentication.class))).build();

        mvc.perform(get("/platform/applications").param("purpose", "navigation"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[0].panelUses.length()").value(2))
            .andExpect(jsonPath("$.data[0].panelUses[0].names['zh-CN']").value("任务"))
            .andExpect(jsonPath("$.data[0].panelUses[1].path").value("/applications/app-panel-a/detail"))
            .andExpect(jsonPath("$.data[0].panelUses[1].names").doesNotExist());
        mvc.perform(get("/platform/applications/app-panel-a/panel-uses"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.panelUses.length()").value(2))
            .andExpect(jsonPath("$.data.panelUses[0].names.en").value("Tasks"));
        assertThrows(ResponseStatusException.class, () -> ApplicationPanelUse.validate(List.of(
            new ApplicationPanelUse("use-invalid", "invalid", "panel-p", "/applications/app-panel-a/invalid",
                new ApplicationPanelUse.Access(null, "domain-member"), null, Map.of("zh-CN", "任务"))
        )));
    }

    @Test void readsPanelUsesThroughTheirOwnMenuAndUseAccessWithoutInventingMappings() {
        var allowed = use("member", null); var denied = use("menu", "menu");
        var application = app("app-panel-a", "panels", List.of(allowed, denied));
        doReturn(application).when(catalog).require("app-panel-a");
        when(access.canEnter(application, user)).thenReturn(true);
        when(access.panelUses(List.of(allowed, denied), user)).thenReturn(List.of(allowed));
        assertEquals(List.of(allowed), catalog.panelUses("app-panel-a", user).getList("panelUses", ApplicationPanelUse.class));
        when(grants.allowed("panel-p", "use")).thenReturn(false);
        assertTrue(catalog.panelUses("app-panel-a", user).getJSONArray("panelUses").isEmpty());
        verify(access, never()).pageSkills(anyList(), any());
    }
}

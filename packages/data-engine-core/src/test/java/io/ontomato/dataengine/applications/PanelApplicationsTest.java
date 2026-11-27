package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.controller.BuildTestAccessInterceptor;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.SqlArrayValue;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

class PanelApplicationsTest {
    private final JdbcTemplate db = mock(JdbcTemplate.class);
    private final TransactionTemplate tx = mock(TransactionTemplate.class);
    private final ApplicationAccess access = mock(ApplicationAccess.class);
    private final PanelResources panels = mock(PanelResources.class);
    private final IdentityPrincipalDirectory grants = mock(IdentityPrincipalDirectory.class);
    private final User user = mock(User.class);
    private final ApplicationCatalog catalog;
    private final io.ontomato.dataengine.service.authorization.AuthorizationService authorization =
        EntryAuthorizationFixture.entries((actor, key) -> !Set.of("app-panel-a/use-denied", "app-panel-a/use-menu").contains(key));

    PanelApplicationsTest() {
        when(user.getId()).thenReturn("author"); when(user.getDomainId()).thenReturn("domain");
        when(tx.execute(any())).thenAnswer(call -> ((TransactionCallback<?>)call.getArgument(0)).doInTransaction(null));


        catalog = spy(new ApplicationCatalog(db, tx, access, "{}", panels, grants, authorization));
        doReturn(List.of()).when(catalog).all();
    }
    private static ApplicationPanelUse use(String page, String permission) {
        return use("app-panel-a", page, permission);
    }
    private static ApplicationPanelUse use(String application, String page, String permission) {
        return new ApplicationPanelUse("use-" + page, page, "panel-p", "/applications/" + application + "/" + page, null, null);
    }
    private static ApplicationCatalog.Declaration metadata() {
        return new ApplicationCatalog.Declaration(Map.of("en", "Example"), Map.of(), "calendar", List.of(), List.of());
    }
    private static JSONObject app(String id, String renderer, List<ApplicationPanelUse> uses) {
        return JSONObject.of("id", id, "domainId", "domain", "ownerUserId", "author",
            "entry", JSONObject.of("renderer", renderer, "path", renderer.equals("panels") ? "/applications/" + id : "/" + id, "entryKey", "main"), "panelUses", uses,
            "entryAccess", List.of(), "panelSettings", new JSONObject());
    }
    private static ApplicationController.PanelRegistration body(List<ApplicationPanelUse> uses, boolean create) {
        return body("app-panel-a", uses, create);
    }
    private static ApplicationController.PanelRegistration body(String application, List<ApplicationPanelUse> uses, boolean create) {
        return new ApplicationController.PanelRegistration(new ApplicationController.PanelEntry("/applications/" + application, "panels"), uses,
            create ? metadata() : null, create ? List.of() : null);
    }

    private static ApplicationPanelUse at(String page, String path) {
        return new ApplicationPanelUse("use-" + page, page, "panel-p", path, null, null);
    }

    private static ApplicationCatalog.Builtin builtin(String id, String path, ApplicationPanelUse use) {
        var platformUse = new ApplicationPanelUse(use.id(), use.pageKey(), "builtin-product-" + use.panelId(),
            use.path(), use.defaultAgent(), use.names(), use.inputs(), use.groupKey());
        var declaration = new ApplicationCatalog.Declaration(Map.of("en", id), Map.of(), "calendar", List.of(), List.of(platformUse));
        return new ApplicationCatalog.Builtin(id, "native", "apps", "admin", 1,
            JSONObject.of("renderer", "panels", "path", path), null, declaration);
    }

    @Test void scopedVisibleEntriesKeepBuiltinReservationsAndEntryAdmission() {
        var requested = app("app-panel-a", "panels", List.of(use("active", null), use("denied", null), use("reserved", null)));
        var builtIn = app("builtin-elsewhere", "panels", List.of(use("builtin-elsewhere", "reserved", null)));
        builtIn.put("domainId", null);
        doReturn(List.of(builtIn, requested)).when(db).query(contains("domain_id = ? AND id = ANY (?)"),
            any(RowMapper.class), eq("domain"), any(SqlArrayValue.class));
        var subject = authorization.resolveSubject(
            new io.ontomato.dataengine.service.authorization.AuthorizationService.VerifiedIdentity("domain", "author",
                io.ontomato.dataengine.service.authorization.AuthorizationService.CredentialLimit.UNRESTRICTED));
        assertEquals(List.of("app-panel-a/use-active"),
            catalog.visibleEntries(subject, Set.of("app-panel-a")).stream().map(ApplicationCatalog.VisibleEntry::id).toList());
    }

    @Test void workbenchOpenUsesTheExistingEntryDecisionAndReturnsCurrentRegistrationWithoutLegacyGrants() {
        var use = use("tasks", null);
        var app = app("app-panel-a", "panels", List.of(use, use("menu", null)));
        app.put("names", Map.of("en", "Panel app"));
        app.put("groups", List.of());
        app.put("allowStandalone", false);
        app.put("panelSettings", JSONObject.of("framePanelId", "frame-root"));
        doReturn(List.of(app)).when(catalog).all();
        var actor = new io.ontomato.dataengine.service.authorization.AuthorizationService.VerifiedIdentity("domain", "author",
            io.ontomato.dataengine.service.authorization.AuthorizationService.CredentialLimit.UNRESTRICTED);
        var subject = authorization.resolveSubject(actor);
        clearInvocations(authorization);

        var opened = catalog.openPanelEntry(use.path(), null, null, subject);
        assertEquals(use, opened.get("use"));
        assertEquals("frame-root", opened.getString("framePanelId"));
        assertFalse(opened.getBooleanValue("allowStandalone"));
        assertEquals(new ApplicationCatalog.PanelReadRegistration("app-panel-a", use, "frame-root"),
            catalog.panelReadRegistrations("domain").apply("app-panel-a", use.id()));
        assertEquals(404, assertThrows(ResponseStatusException.class,
            () -> catalog.panelReadRegistrations("another-domain").apply("app-panel-a", use.id())).getStatusCode().value());
        assertEquals(403, assertThrows(ResponseStatusException.class,
            () -> catalog.openPanelEntry(null, "app-panel-a", "use-menu", subject)).getStatusCode().value());
        verify(authorization, never()).resolveSubject(any());
        verifyNoInteractions(grants);
    }

    @Test void rejectsDomainPathsOutsideTheAssignedSpaceAndNormalizedDuplicatesWithoutWrites() {
        for (var path : List.of("/ontology/agents", "/applications/app-panel-b/tasks", "/applications/app-panel-ab/tasks",
            "/applications/app-panel-a/%2e%2e/app-panel-b/tasks", "/applications/app-panel-a/%2Ftasks",
            "/applications/app-panel-a/tasks?selected=task-1")) {
            assertThrows(ResponseStatusException.class, () -> catalog.putPanelUses("app-panel-a", body(List.of(at("tasks", path)), true), user));
        }
        var widened = new ApplicationController.PanelRegistration(new ApplicationController.PanelEntry("/ontology", "panels"),
            List.of(at("agents", "/ontology/agents")), metadata(), List.of());
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
        var galleryEntry = JSONObject.of("renderer", "application-gallery", "path", "/applications", "home", "/applications", "entryKey", "main");
        var gallery = JSONObject.of("id", "application-gallery", "kind", "native", "ownerService", "workbench",
            "entry", galleryEntry, "panelUses", List.of(), "entryAccess", List.of());
        gallery.put("domainId", null);
        doReturn(gallery).when(catalog).require("application-gallery");
        var declaration = new ApplicationCatalog.Declaration(Map.of("en", "Application gallery"), Map.of(), "gallery", List.of(), List.of());
        catalog.builtins("workbench", List.of(new ApplicationCatalog.Builtin("application-gallery", "native", "top", "business", 2,
            galleryEntry, null, declaration)));
        assertThrows(ResponseStatusException.class, () ->
            catalog.builtins("workbench", List.of(builtin("gallery-child", "/applications/gallery-child", at("x", "/applications/gallery-child/x")))));

        var trial = app("app-panel-a", "panels", List.of());
        doReturn(List.of(gallery, trial)).when(catalog).all();
        EntryAuthorizationFixture.allowEdit(authorization, user, trial);
        var response = catalog.putPanelUses("app-panel-a", body(List.of(use("tasks", null)), false), user);
        assertEquals("/applications/app-panel-a/tasks", response.getList("panelUses", ApplicationPanelUse.class).getFirst().path());
    }

    @Test void oldTrialPathsFailTheDirectReadAndDoNotBlockAnotherTrialBeingReRegistered() throws Exception {
        var trialA = app("app-panel-a", "panels", List.of(at("a", "/tasks")));
        var trialB = app("app-panel-b", "panels", List.of(at("b", "/summary")));
        doReturn(List.of(trialA, trialB)).when(catalog).all();
        EntryAuthorizationFixture.allowEdit(authorization, user, trialA);
        var identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(user);
        var mvc = MockMvcBuilders.standaloneSetup(new ApplicationController(catalog, identity, mock(WorkbenchServiceAuthentication.class)))
            .setControllerAdvice(new ApplicationErrors()).build();

        mvc.perform(get("/platform/applications/app-panel-a/panel-uses"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("app-panel-a")));
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
            {"entry":{"path":"/applications/app-panel-a/","renderer":"panels"},"initialOpenEntryIds":["use-a"],
             "declaration":{"names":{"en":"Example"},"descriptions":{},"icon":"calendar","groups":[]},
             "panelUses":[{"id":"use-a","pageKey":"schedules-a","panelId":"panel-p","path":"/applications/app-panel-a/%73chedules-a/","defaultAgent":{"kind":"id","id":"preferred-agent"},"names":{"en":"Tasks","zh-CN":"任务"}}]}
            """)).andExpect(status().isOk()).andReturn();
        assertEquals("panels", JSONObject.parseObject(result.getResponse().getContentAsString()).getJSONObject("data").getJSONObject("entry").getString("renderer"));
        var savedUse = JSONObject.parseObject(result.getResponse().getContentAsString()).getJSONObject("data").getJSONArray("panelUses").getJSONObject(0);
        assertFalse(savedUse.containsKey("skill"));
        assertFalse(savedUse.containsKey("access"));
        verify(access).initialOpenEntries(user, Set.of("app-panel-a/use-a"));
        assertEquals("/applications/app-panel-a/schedules-a", savedUse.getString("path"));
        assertEquals("preferred-agent", savedUse.getJSONObject("defaultAgent").getString("id"));
        assertEquals("任务", savedUse.getJSONObject("names").getString("zh-CN"));
        verify(panels).requireUsableRegistration(eq("domain"), isNull(),
            argThat(usesPassed -> usesPassed.stream().map(ApplicationPanelUse::panelId).toList().equals(List.of("panel-p"))),
            isNull(), isNull(), eq("calendar"), any(java.util.Locale.class));
    }

    @Test void domainOpeningChecksMaintenanceAndTheActualEntryThroughHttp() throws Exception {
        doAnswer(call -> {
            call.<java.util.function.Consumer<org.springframework.transaction.TransactionStatus>>getArgument(0).accept(null);
            return null;
        }).when(tx).executeWithoutResult(any());
        var application = app("app-panel-a", "panels", List.of(use("tasks", null)));
        doReturn(List.of(application)).when(catalog).all();
        var identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(user);
        var http = MockMvcBuilders.standaloneSetup(new ApplicationController(catalog, identity,
            mock(WorkbenchServiceAuthentication.class))).setControllerAdvice(new ApplicationErrors()).build();
        var base = "/platform/applications/app-panel-a/entries/";

        http.perform(put(base + "use-tasks/domain-opening").contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"open":true}
                """)).andExpect(status().isForbidden());
        EntryAuthorizationFixture.allowEdit(authorization, user, application);
        http.perform(put(base + "other/domain-opening").contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"open":true}
                """)).andExpect(status().isNotFound());
        http.perform(put(base + "use-tasks/domain-opening").contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"open":"true"}
                """)).andExpect(status().isBadRequest());
        http.perform(put(base + "use-tasks/domain-opening").contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"open":true}
                """)).andExpect(status().isNoContent());
        verify(access).requestDomainEntryOpening(user, "app-panel-a/use-tasks", true);
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
        doThrow(new ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST)).when(panels).requireUsableRegistration(eq("domain"), isNull(), eq(List.of(use("schedules-a", null))), isNull(), isNull(), eq("calendar"), isNull());
        assertThrows(ResponseStatusException.class, () -> catalog.putPanelUses("app-panel-a", body(List.of(use("schedules-a", null)), true), user));
        verify(db, never()).update(anyString(), any(Object[].class));
    }

    @Test void requiresTheExistingPanelsApplicationMaintainerAndKeepsMetadataOnRelationOnlyUpdates() {
        var existing = app("app-panel-a", "panels", List.of()); doReturn(List.of(existing)).when(catalog).all();
        assertThrows(ResponseStatusException.class, () -> catalog.putPanelUses("app-panel-a", body(List.of(use("schedules-a", null)), false), user));
        verify(db, never()).update(anyString(), any(Object[].class));
        EntryAuthorizationFixture.allowEdit(authorization, user, existing);
        catalog.putPanelUses("app-panel-a", body(List.of(use("schedules-a", null)), false), user);
        verify(db).update(startsWith("UPDATE sys_application SET entry="), any(Object[].class));
        verify(access, never()).declare(any(), any(), anyBoolean());
        verify(access, never()).initialOpenEntries(any(), anySet());
    }

    @Test void validatesUseLocators() {
        var first = use("schedules-a", null); var second = use("schedules-b", null);
        assertDoesNotThrow(() -> ApplicationPanelUse.validate(List.of(first, second)));
        assertDoesNotThrow(() -> ApplicationPanelUse.validate(List.of(use("form", "menu"), use("summary", "menu"))));
        assertThrows(ResponseStatusException.class, () -> ApplicationPanelUse.validate(List.of(first, first)));
    }

    @Test void keepsMemberLocatorsUniqueAcrossApplications() {
        doReturn(List.of(app("app-existing", "panels", List.of(use("app-existing", "schedules-a", null))))).when(catalog).all();
        assertThrows(ResponseStatusException.class, () -> catalog.putPanelUses("app-panel-a", body(List.of(use("schedules-a", null)), true), user));
        verify(db, never()).update(anyString(), any(Object[].class));
    }

    @Test void navigationCatalogReturnsSummaryWithoutPanelUsesWhileSingleApplicationViewKeepsAdmittedPanelUses() throws Exception {
        var named = new ApplicationPanelUse("use-named", "named", "panel-p", "/applications/app-panel-a/named", null, Map.of("en", "Tasks", "zh-CN", "任务"));
        var denied = new ApplicationPanelUse("use-denied", "denied", "panel-q", "/applications/app-panel-a/denied", null, Map.of("en", "Hidden"));
        var detail = use("detail", null);
        var objectRestricted = new ApplicationPanelUse("restricted", "restricted", "panel-restricted",
            "/applications/app-panel-a/restricted", null, null);
        var declared = List.of(named, denied, detail, objectRestricted);

        var application = app("app-panel-a", "panels", declared);
        application.put("panelSettings", JSONObject.of("framePanelId", "panel-frame"));
        doReturn(List.of(application)).when(catalog).all();
        var identity = mock(IdentityService.class); when(identity.getCurrentUser()).thenReturn(user);
        var mvc = MockMvcBuilders.standaloneSetup(new ApplicationController(catalog, identity, mock(WorkbenchServiceAuthentication.class))).build();

        mvc.perform(get("/platform/applications").param("purpose", "navigation"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[0].id").value("app-panel-a"))
            .andExpect(jsonPath("$.data[0].framePanelId").value("panel-frame"))
            .andExpect(jsonPath("$.data[0].allowStandalone").value(true))
            .andExpect(jsonPath("$.data[0].entryPaths").value(org.hamcrest.Matchers.containsInAnyOrder(
                named.path(), detail.path(), objectRestricted.path())))
            .andExpect(jsonPath("$.data[0].panelUses").doesNotExist())
            .andExpect(jsonPath("$.data[0].permissions").doesNotExist())
            .andExpect(jsonPath("$.data[0].panelSettings").doesNotExist());

        mvc.perform(get("/platform/applications/app-panel-a"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.framePanelId").value("panel-frame"))
            .andExpect(jsonPath("$.data.entryPaths").value(org.hamcrest.Matchers.containsInAnyOrder(
                named.path(), detail.path(), objectRestricted.path())))
            .andExpect(jsonPath("$.data.panelUses.length()").value(3))
            .andExpect(jsonPath("$.data.panelUses[0].names['zh-CN']").value("任务"))
            .andExpect(jsonPath("$.data.panelUses[1].path").value("/applications/app-panel-a/detail"))
            .andExpect(jsonPath("$.data.panelUses[1].names").doesNotExist());
        mvc.perform(get("/platform/applications/app-panel-a/panel-uses"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.panelUses.length()").value(3))
            .andExpect(jsonPath("$.data.panelUses[0].names.en").value("Tasks"));
        assertDoesNotThrow(() -> ApplicationPanelUse.validate(List.of(
            new ApplicationPanelUse("use-zh", "zh-only", "panel-p", "/applications/app-panel-a/zh-only", null, Map.of("zh-CN", "任务"))
        )));
        assertThrows(ResponseStatusException.class, () -> ApplicationPanelUse.validate(List.of(
            new ApplicationPanelUse("use-invalid", "invalid", "panel-p", "/applications/app-panel-a/invalid", null, Map.of())
        )));
        assertThrows(ResponseStatusException.class, () -> ApplicationPanelUse.validate(List.of(
            new ApplicationPanelUse("use-blank", "blank", "panel-p", "/applications/app-panel-a/blank", null, Map.of("zh-CN", "   "))
        )));
    }

    @Test void listsOnlyAuthorizedPanelEntries() {
        var allowed = use("member", null); var denied = use("menu", "menu");
        var application = app("app-panel-a", "panels", List.of(allowed, denied));
        doReturn(List.of(application)).when(catalog).all();
        assertEquals(List.of(allowed), catalog.panelUses("app-panel-a", user).getList("panelUses", ApplicationPanelUse.class));

    }

    @Test void entryResolutionDoesNotReadPanelDefinitions() {
        var allowed = use("first", null);
        var denied = new ApplicationPanelUse("use-second", "second", "panel-other", "/applications/app-panel-a/second", null, null);
        var duplicate = use("third", null);
        var uses = List.of(allowed, denied, duplicate);
        var application = app("app-panel-a", "panels", uses);
        doReturn(List.of(application)).when(catalog).all();


        assertEquals(uses, catalog.panelUses("app-panel-a", user)
                .getList("panelUses", ApplicationPanelUse.class));
        verifyNoInteractions(panels);
    }

    @Test void proxyAndServiceRegistrationRetainTheirCredentialBoundaries() throws Exception {
        var connected = app("app-connected", "connected", List.of());
        connected.put("kind", "connected");
        connected.put("entry", JSONObject.of("path", "/apps/app-connected/", "entryKey", "main",
            "upstream", "connected-service", "upstreamPrefix", "/connector/"));
        var declared = app("app-panel-a", "panels", List.of(use("denied", null)));
        doReturn(List.of(connected, declared)).when(catalog).all();
        when(access.entryUser("verified-user")).thenReturn(user);
        var identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(user);
        var http = MockMvcBuilders.standaloneSetup(new AppEntryController(catalog, access),
            new ApplicationController(catalog, identity, new WorkbenchServiceAuthentication("service-fixture")))
            .setControllerAdvice(new ApplicationErrors()).addInterceptors(new BuildTestAccessInterceptor()).build();

        var proxy = "/internal/app-entry";
        http.perform(get(proxy).header("X-App-Request-Uri", "/apps/app-connected/config?view=one"))
            .andExpect(status().isUnauthorized());
        http.perform(get(proxy).header("X-App-Request-Uri", "/apps/app-connected/config?view=one")
                .header("X-App-Credential", "verified-user"))
            .andExpect(status().isNoContent())
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.header()
                .string("X-App-Proxy-Path", "/connector/config?view=one"));
        http.perform(get(proxy).header("X-App-Request-Uri", "/apps/app-connected/config")
                .header("X-App-Credential", "verified-user").header(DataSandboxService.HEADER, "{}"))
            .andExpect(status().isUnprocessableEntity());

        String select = "?applicationId=app-panel-a&useId=use-denied";
        http.perform(get("/platform/applications/resolve-entry" + select))
            .andExpect(status().isForbidden());
        http.perform(get("/platform/applications/registered-entry" + select))
            .andExpect(status().isForbidden());
        http.perform(get("/platform/applications/registered-entry" + select)
                .header(WorkbenchServiceAuthentication.HEADER, "service-fixture"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.use.id").value("use-denied"));
    }

    @Test void reverseLookupIncludesBuiltinAndDomainUsesButNoOtherDomainAndRequiresServiceAuth() throws Exception {
        var local = app("app-panel-a", "panels", List.of(use("tasks", "app:app-panel-a:private")));
        local.put("names", JSONObject.of("en", "Local app", "zh-CN", "域内应用"));
        var foreign = app("app-foreign", "panels", List.of(use("app-foreign", "tasks", null)));
        foreign.put("domainId", "foreign");
        var builtin = app("ontology", "panels", List.of(at("settings", "/ontology/settings")));
        builtin.put("domainId", null);
        builtin.put("names", JSONObject.of("en", "Ontology"));
        doReturn(List.of(local, foreign, builtin)).when(catalog).all();
        var mvc = MockMvcBuilders.standaloneSetup(new ApplicationController(catalog, mock(IdentityService.class),
            new WorkbenchServiceAuthentication("service-fixture"))).build();

        mvc.perform(get(ApplicationController.PANEL_USES_BY_PANEL).param("domainId", "domain").param("panelId", "panel-p"))
            .andExpect(status().isForbidden());
        mvc.perform(get(ApplicationController.PANEL_USES_BY_PANEL).header(WorkbenchServiceAuthentication.HEADER, "service-fixture")
            .param("domainId", "domain").param("panelId", "panel-p"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.length()").value(2))
            .andExpect(jsonPath("$.data[0].applicationId").value("app-panel-a"))
            .andExpect(jsonPath("$.data[0].names.en").value("Local app"))
            .andExpect(jsonPath("$.data[0].names['zh-CN']").value("域内应用"))
            .andExpect(jsonPath("$.data[0].useId").value("use-tasks"))
            .andExpect(jsonPath("$.data[0].path").value("/applications/app-panel-a/tasks"))
            .andExpect(jsonPath("$.data[1].applicationId").value("ontology"));
    }

    @Test void deleteRespectsDomainMaintenanceAndRemovesTheApplicationWithItsPanelUses() throws Exception {
        doAnswer(call -> {
            call.<java.util.function.Consumer<org.springframework.transaction.TransactionStatus>>getArgument(0).accept(null);
            return null;
        }).when(tx).executeWithoutResult(any());
        var local = app("app-panel-a", "panels", List.of(use("tasks", null)));
        local.put("names", JSONObject.of("en", "Local app"));
        var builtin = app("ontology", "panels", List.of(at("settings", "/ontology/settings")));
        builtin.put("domainId", null);
        builtin.put("names", JSONObject.of("en", "Ontology"));
        var applications = new AtomicReference<>(List.of(local, builtin));
        doAnswer(call -> applications.get()).when(catalog).all();
        when(db.update("DELETE FROM sys_application WHERE id=? AND domain_id=?", "app-panel-a", "domain"))
            .thenAnswer(call -> {
                applications.set(List.of(builtin));
                return 1;
            });
        var identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(user);
        var mvc = MockMvcBuilders.standaloneSetup(new ApplicationController(catalog, identity,
            new WorkbenchServiceAuthentication("service-fixture"))).build();

        mvc.perform(delete("/platform/applications/ontology")).andExpect(status().isForbidden());
        mvc.perform(delete("/platform/applications/app-panel-a")).andExpect(status().isForbidden());
        verify(db, never()).update(startsWith("DELETE FROM sys_application"), anyString(), anyString());
        verify(access, never()).retire(any());
        EntryAuthorizationFixture.allowEdit(authorization, user, local);

        mvc.perform(delete("/platform/applications/app-panel-a")).andExpect(status().isNoContent());
        var retirement = inOrder(access, db);
        retirement.verify(access).retire(local);
        retirement.verify(db).update("DELETE FROM sys_application WHERE id=? AND domain_id=?", "app-panel-a", "domain");
        mvc.perform(get(ApplicationController.PANEL_USES_BY_PANEL).header(WorkbenchServiceAuthentication.HEADER, "service-fixture")
            .param("domainId", "domain").param("panelId", "panel-p"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.length()").value(1))
            .andExpect(jsonPath("$.data[0].applicationId").value("ontology"));
    }

    @Test void preservesEntryIconAndRejectsBlankEntryIcon() {
        var withIcon = new ApplicationPanelUse("use-roles", "roles", "panel-p", "/applications/app-panel-a/roles", null, Map.of("en", "Roles"),
            null, null, null, "user-cog");
        assertEquals("user-cog", ApplicationPanelUse.canonical(List.of(withIcon)).getFirst().icon());
        var blankIcon = new ApplicationPanelUse("use-blank-icon", "blank-icon", "panel-p", "/applications/app-panel-a/blank-icon", null, Map.of("en", "Blank"),
            null, null, null, "   ");
        assertThrows(ResponseStatusException.class, () -> ApplicationPanelUse.validate(List.of(blankIcon)));
    }

    @Test void validatesBuiltinNativeEntriesAndRejectsThemOnDomainWrites() throws Exception {
        var nativeEntry = new ApplicationPanelUse("system-monitor", "system-monitor", null, "/settings/records/system-monitor", null, Map.of("en", "System monitoring"),
            null, null, "records", "activity", ApplicationPanelUse.NATIVE_KIND);
        assertTrue(nativeEntry.nativeEntry());
        // Domain write validation rejects kind="native".
        assertThrows(ResponseStatusException.class, () -> ApplicationPanelUse.validate(List.of(nativeEntry)));
        // Built-in validation accepts explicit kind="native" without panel-only fields.
        assertEquals(ApplicationPanelUse.NATIVE_KIND,
            ApplicationPanelUse.canonical(List.of(nativeEntry), true).getFirst().kind());
        // Native entries cannot declare panelId, inputs, or defaultAgent.
        var withPanelId = new ApplicationPanelUse("bad-native-panel", "bad-native-panel", "builtin-product-audit-log",
            "/settings/records/bad-1", null,
            Map.of("en", "Bad"), null, null, "records", "activity", ApplicationPanelUse.NATIVE_KIND);
        assertThrows(ResponseStatusException.class, () -> ApplicationPanelUse.validate(List.of(withPanelId), true));
        var withInputs = new ApplicationPanelUse("bad-native-inputs", "bad-native-inputs", null,
            "/settings/records/bad-2", null,
            Map.of("en", "Bad"), null, Map.of("x", Map.of("literal", "y")), "records", "activity", ApplicationPanelUse.NATIVE_KIND);
        assertThrows(ResponseStatusException.class, () -> ApplicationPanelUse.validate(List.of(withInputs), true));
        // Omitting panelId without explicit kind="native" is still rejected even for built-ins.
        var missingPanelId = new ApplicationPanelUse("missing-panel", "missing-panel", null,
            "/settings/records/missing", null,
            Map.of("en", "Missing"), null, null, "records", "activity", null);
        assertThrows(ResponseStatusException.class, () -> ApplicationPanelUse.validate(List.of(missingPanelId), true));

        // Shipped settings.json parses cleanly with its 4 groups, 7 panel entries, and shared system-monitor native entry.
        var settings = ApplicationCatalogUpgrade.Builtins.readDeclaration(
            new org.springframework.core.io.ClassPathResource("applications/settings.json"));
        assertEquals("settings", settings.id());
        assertEquals(4, settings.declaration().groups().size());
        var uses = ApplicationPanelUse.canonical(settings.declaration().panelUses(), true);
        assertEquals(8, uses.size());
        var monitor = uses.stream().filter(use -> "system-monitor".equals(use.id())).findFirst().orElseThrow();
        assertTrue(monitor.nativeEntry());
        assertEquals("/settings/records/system-monitor", monitor.path());
        assertEquals("records", monitor.groupKey());
        assertEquals("activity", monitor.icon());
        var iconsById = uses.stream().collect(java.util.stream.Collectors.toMap(ApplicationPanelUse::id, ApplicationPanelUse::icon));
        assertEquals("sliders-horizontal", iconsById.get("general-settings"));
        assertEquals("cable", iconsById.get("external-mcp"));
        assertEquals("plug", iconsById.get("published-mcp"));
        assertEquals("scroll-text", iconsById.get("audit-log"));
    }

    @Test void preservesPageComposerAndRejectsInvalidOrNativePageComposer() {
        var noneUse = new ApplicationPanelUse("home", "home", "panel-p", "/applications/app-panel-a/home", null, Map.of("en", "Home"),
            null, null, null, null, null, ApplicationPanelUse.PAGE_COMPOSER_NONE);
        assertEquals("none", ApplicationPanelUse.canonical(List.of(noneUse)).getFirst().pageComposer());

        var bottomUse = new ApplicationPanelUse("home-bottom", "home-bottom", "panel-p", "/applications/app-panel-a/bottom", null, Map.of("en", "Bottom"),
            null, null, null, null, null, ApplicationPanelUse.PAGE_COMPOSER_BOTTOM);
        assertEquals("bottom", ApplicationPanelUse.canonical(List.of(bottomUse)).getFirst().pageComposer());

        var invalidUse = new ApplicationPanelUse("home-bad", "home-bad", "panel-p", "/applications/app-panel-a/bad", null, Map.of("en", "Bad"),
            null, null, null, null, null, "inline");
        assertThrows(ResponseStatusException.class, () -> ApplicationPanelUse.validate(List.of(invalidUse)));

        var nativeWithComposer = new ApplicationPanelUse("bad-native-composer", "bad-native-composer", null,
            "/settings/records/bad-composer", null,
            Map.of("en", "Bad"), null, null, "records", "activity", ApplicationPanelUse.NATIVE_KIND,
            ApplicationPanelUse.PAGE_COMPOSER_NONE);
        assertThrows(ResponseStatusException.class, () -> ApplicationPanelUse.validate(List.of(nativeWithComposer), true));
    }
}

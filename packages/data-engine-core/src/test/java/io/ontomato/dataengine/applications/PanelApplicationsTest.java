package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
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
        return new ApplicationPanelUse("use-" + page, page, "panel-p", "/" + page,
            permission == null ? new ApplicationPanelUse.Access(null, "domain-member") : new ApplicationPanelUse.Access(permission, null), null);
    }
    private static ApplicationCatalog.Declaration metadata() {
        return new ApplicationCatalog.Declaration(Map.of("en", "Example"), Map.of(), "calendar", List.of(), List.of(), List.of(), List.of());
    }
    private static JSONObject app(String id, String renderer, List<ApplicationPanelUse> uses) {
        return JSONObject.of("id", id, "domainId", "domain", "ownerUserId", "author",
            "entry", JSONObject.of("renderer", renderer, "path", "/" + id), "panelUses", uses,
            "pageSkills", List.of(), "entryAccess", List.of("domain-member"));
    }
    private static ApplicationController.PanelRegistration body(List<ApplicationPanelUse> uses, boolean create) {
        return new ApplicationController.PanelRegistration(new ApplicationController.PanelEntry("/panel-example", "panels"), uses,
            create ? metadata() : null, create ? List.of("domain-member") : null);
    }

    @Test void createsANewPanelsApplicationThroughTheRealJacksonHttpBoundaryWithoutPersistingPageSkills() throws Exception {
        var application = app("app-panel-a", "panels", List.of(use("schedules-a", null)));
        doReturn(application).when(catalog).require("app-panel-a");
        var identity = mock(IdentityService.class); when(identity.getCurrentUser()).thenReturn(user);
        var mvc = MockMvcBuilders.standaloneSetup(new ApplicationController(catalog, identity, mock(WorkbenchServiceAuthentication.class))).build();
        var result = mvc.perform(put("/platform/applications/app-panel-a/panel-uses").contentType(MediaType.APPLICATION_JSON).content("""
            {"entry":{"path":"/panel-example","renderer":"panels"},"entryAccess":["domain-member"],
             "declaration":{"names":{"en":"Example"},"descriptions":{},"icon":"calendar","groups":[],"permissions":[]},
             "panelUses":[{"id":"use-a","pageKey":"schedules-a","panelId":"panel-p","path":"/schedules-a",
               "access":{"kind":"domain-member"},"defaultAgentId":"preferred-agent"}]}
            """)).andExpect(status().isOk()).andReturn();
        assertEquals("panels", JSONObject.parseObject(result.getResponse().getContentAsString()).getJSONObject("data").getJSONObject("entry").getString("renderer"));
        var savedUse = JSONObject.parseObject(result.getResponse().getContentAsString()).getJSONObject("data").getJSONArray("panelUses").getJSONObject(0);
        assertFalse(savedUse.containsKey("skill"));
        assertEquals("preferred-agent", savedUse.getString("defaultAgentId"));
        var dashboard = new PageSkills.Mapping(null, "domain-member", "dashboard",
            new PageSkills.Skill(new PageSkills.Namespace("provider", "workbench", null), "dashboard-pages"), null);
        var legacy = app("dashboards", "dashboards", List.of()); legacy.put("pageSkills", List.of(dashboard));
        doReturn(List.of(application, legacy)).when(catalog).all();
        when(access.pageSkills(List.of(dashboard), user)).thenReturn(List.of(dashboard));
        var projected = mvc.perform(get("/platform/page-skills")).andExpect(status().isOk()).andReturn();
        var projection = JSONObject.parseObject(projected.getResponse().getContentAsString()).getJSONObject("data");
        assertEquals(List.of("dashboard"), projection.getJSONArray("pageSkills").toJavaList(JSONObject.class).stream().map(value -> value.getString("pageKey")).toList());
        assertEquals(List.of("dashboard-pages"), projection.getJSONArray("registeredSkills").toJavaList(JSONObject.class).stream().map(value -> value.getString("name")).toList());
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

    @Test void validatesUseLocatorsWithoutProducingSkills() {
        var first = use("schedules-a", null); var second = use("schedules-b", null);
        assertDoesNotThrow(() -> ApplicationPanelUse.validate(List.of(first, second)));
        assertNotEquals(first.locator(), second.locator());
        assertDoesNotThrow(() -> ApplicationPanelUse.validate(List.of(use("form", "menu"), use("summary", "menu"))));
        assertThrows(ResponseStatusException.class, () -> ApplicationPanelUse.validate(List.of(first, first)));
    }

    @Test void keepsMemberLocatorsUniqueAcrossApplicationsWithoutAnyPanelSkill() {
        doReturn(List.of(app("app-existing", "panels", List.of(use("schedules-a", null))))).when(catalog).all();
        assertThrows(ResponseStatusException.class, () -> catalog.putPanelUses("app-panel-a", body(List.of(use("schedules-a", null)), true), user));
        verify(db, never()).update(anyString(), any(Object[].class));
    }

    @Test void sharesAMenuGroupAcrossPanelsWithoutInventingASkill() {
        var first = app("app-panel-a", "panels", List.of(use("schedules-a", "menu")));
        var second = app("app-panel-b", "panels", List.of(new ApplicationPanelUse("use-b", "schedules-b", "panel-q", "/tasks", new ApplicationPanelUse.Access("menu", null), null)));
        doReturn(List.of(first)).when(catalog).all(); doReturn(second).when(catalog).require("app-panel-b");
        catalog.putPanelUses("app-panel-b", body(second.getList("panelUses", ApplicationPanelUse.class), true), user);
        doReturn(List.of(first, second)).when(catalog).all();
        when(access.pageSkills(List.of(), user)).thenReturn(List.of());
        assertTrue(catalog.pageSkills(user).pageSkills().isEmpty());
        assertTrue(catalog.pageSkills(user).registeredSkills().isEmpty());
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

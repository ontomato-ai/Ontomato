package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
    private static final PageSkills.Skill SKILL = new PageSkills.Skill(new PageSkills.Namespace("provider", "workbench", null), "schedule-panels");
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
            permission == null ? new ApplicationPanelUse.Access(null, "domain-member") : new ApplicationPanelUse.Access(permission, null), SKILL, null);
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
               "access":{"kind":"domain-member"},"skill":{"namespace":{"kind":"provider","provider":"workbench"},"name":"schedule-panels"}}]}
            """)).andExpect(status().isOk()).andReturn();
        assertEquals("panels", JSONObject.parseObject(result.getResponse().getContentAsString()).getJSONObject("data").getJSONObject("entry").getString("renderer"));
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

    @Test void projectsDistinctMemberPagesAndGroupsOneMenuCodeIntoOneSkillPackage() {
        var member = ApplicationPanelUse.project(List.of(use("schedules-a", null), use("schedules-b", null)));
        assertNotEquals(member.getFirst().locator(), member.getLast().locator());
        PageSkills.validate(member);
        var menu = ApplicationPanelUse.project(List.of(use("form", "menu"), use("summary", "menu")));
        assertEquals(List.of("menu"), menu.stream().map(PageSkills.Mapping::permissionCode).toList());
        assertThrows(ResponseStatusException.class, () -> PageSkills.validate(List.of(new PageSkills.Mapping(null, "domain-member", null, SKILL, null))));
    }

    @Test void refusesMixedLegacyAndPanelsRegistrationForTheSameMenuCode() {
        var legacy = app("app-existing", "native", List.of());
        legacy.put("pageSkills", List.of(new PageSkills.Mapping("menu", null, null, SKILL, null)));
        doReturn(List.of(legacy)).when(catalog).all();
        assertThrows(ResponseStatusException.class, () -> catalog.putPanelUses("app-panel-a", body(List.of(use("schedules-a", "menu")), true), user));
        verify(db, never()).update(anyString(), any(Object[].class));
    }

    @Test void deniesLegacyPublicationForAnAlreadyManagedPanelsApplication() {
        doReturn(List.of(app("app-panel-a", "panels", List.of()))).when(catalog).all();
        assertThrows(ResponseStatusException.class, () -> catalog.publishProduct("app-panel-a", metadata(), "release", user));
        verify(db, never()).update(anyString(), any(Object[].class));
    }
}

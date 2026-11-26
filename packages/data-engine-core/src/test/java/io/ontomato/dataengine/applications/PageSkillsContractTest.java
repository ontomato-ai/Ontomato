package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.*;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.ProductPrincipalLookup;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

class PageSkillsContractTest {
    private static final PageSkills.Skill SKILL =
        new PageSkills.Skill(new PageSkills.Namespace("provider", "ontology", null), "knowledge-governance");

    @Test void rejectsDuplicateEntryBindingsAtRegistration() {
        var declaration = new PageSkills.Declaration("main", "knowledge", SKILL, null);
        assertThrows(ResponseStatusException.class, () -> PageSkills.validate(List.of(declaration, declaration)));
    }

    @Test void globalCatalogueKeepsTheSkillAndDefaultAtTheRegisteredEntry() throws Exception {
        var catalog = spy(new ApplicationCatalog(mock(JdbcTemplate.class), mock(TransactionTemplate.class),
            mock(ApplicationAccess.class), "{}", mock(PanelResources.class), mock(ProductPrincipalLookup.class),
            EntryAuthorizationFixture.allowEntries()));
        var unrelated = new ApplicationPanelUse("other-use", "other", "panel-other",
            "/ontology/other", null, null);
        var knowledge = new ApplicationPanelUse("knowledge-use", "knowledge", "builtin-product-knowledge",
            "/ontology/knowledge", new DefaultAgentTarget("id", "knowledge-agent", null), null);
        doReturn(List.of(JSONObject.of("id", "ontology", "domainId", "domain",
            "entry", JSONObject.of("path", "/ontology", "renderer", "ontology"),
            "panelUses", List.of(unrelated, knowledge),
            "pageSkills", List.of(new PageSkills.Declaration("knowledge-use", "knowledge", SKILL, List.of())))))
            .when(catalog).all();
        var identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(new QueryAccessService.GrantUser("reader", "domain"));
        var http = MockMvcBuilders.standaloneSetup(new ApplicationController(catalog, identity,
            mock(WorkbenchServiceAuthentication.class))).build();

        var response = http.perform(get("/platform/page-skills"))
            .andExpect(jsonPath("$.data.pageSkills").value(hasSize(2)));
        expectKnowledgeMapping(response);
    }

    static void expectKnowledgeMapping(ResultActions response) throws Exception {
        var entry = "[?(@.applicationId == 'ontology' && @.entryKey == 'knowledge-use')]";
        var mapping = "$.data.pageSkills" + entry;
        response.andExpect(status().isOk())
            .andExpect(jsonPath(mapping).value(hasSize(1)))
            .andExpect(jsonPath(mapping + ".skill.name").value(contains(SKILL.name())))
            .andExpect(jsonPath(mapping + ".defaults[*].pageKey").value(contains("knowledge")))
            .andExpect(jsonPath(mapping + ".defaults[*].defaultAgent.id").value(contains("knowledge-agent")))
            .andExpect(jsonPath("$.data.admittedEntrances" + entry + ".pageKey").value(contains("knowledge")))
            .andExpect(jsonPath("$.data.registeredSkills[*].name").value(hasItem(SKILL.name())));
    }

    @Test void scopedHttpLookupCannotBorrowAnotherEntrysAdmissionForTheSamePanel() throws Exception {
        var authorization = EntryAuthorizationFixture.entries((actor, target) -> target.equals("app-example/allowed"));
        var catalog = spy(new ApplicationCatalog(mock(JdbcTemplate.class), mock(TransactionTemplate.class),
            mock(ApplicationAccess.class), "{}", mock(PanelResources.class), mock(ProductPrincipalLookup.class), authorization));
        var allowed = new ApplicationPanelUse("allowed", "page-a", "panel-shared",
            "/applications/app-example/allowed", null, null);
        var denied = new ApplicationPanelUse("denied", "page-b", "panel-shared",
            "/applications/app-example/denied", null, null);
        var app = JSONObject.of("id", "app-example", "domainId", "domain",
            "entry", JSONObject.of("path", "/applications/app-example", "renderer", "panels"),
            "panelUses", List.of(allowed, denied),
            "pageSkills", List.of(new PageSkills.Declaration("denied", "page-b", SKILL, null)));
        doReturn(List.of(app)).when(catalog).all();
        var identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(new QueryAccessService.GrantUser("reader", "domain"));
        var http = MockMvcBuilders.standaloneSetup(new ApplicationController(catalog, identity,
            mock(WorkbenchServiceAuthentication.class))).build();

        http.perform(get("/platform/page-skills").param("applicationId", "app-example")
                .param("entryKey", "denied").param("pageKey", "page-b").param("panelId", "panel-shared"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.admittedEntrances").isEmpty())
            .andExpect(jsonPath("$.data.pageSkills").isEmpty())
            .andExpect(jsonPath("$.data.registeredSkills[0].name").value(SKILL.name()));

        http.perform(get("/platform/page-skills").param("applicationId", "app-example")
                .param("entryKey", "allowed").param("pageKey", "page-a").param("panelId", "panel-shared"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.admittedEntrances[0].applicationId").value("app-example"))
            .andExpect(jsonPath("$.data.admittedEntrances[0].entryKey").value("allowed"))
            .andExpect(jsonPath("$.data.admittedEntrances[0].pageKey").value("page-a"))
            .andExpect(jsonPath("$.data.pageSkills[0].entryKey").value("allowed"));
    }
}

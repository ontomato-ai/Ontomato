package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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

    @BeforeEach void setup() {
        new ApplicationCatalogUpgrade(jdbc).afterPropertiesSet();
        access = mock(ApplicationAccess.class);
        identity = mock(IdentityService.class);
        grants = mock(ProductGrantService.class);
        catalog = new ApplicationCatalog(jdbc,
            new TransactionTemplate(new DataSourceTransactionManager(dataSource)), access, "{}", mock(PanelResources.class), grants);
        http = MockMvcBuilders.standaloneSetup(new ApplicationController(catalog, identity,
            new WorkbenchServiceAuthentication("test-service")))
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
        http.perform(get("/platform/page-skills")).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.pageSkills.length()").value(metadata.pageSkills().size()))
            .andExpect(jsonPath("$.data.pageSkills[0].skill.name").value("knowledge-governance"))
            .andExpect(jsonPath("$.data.pageSkills[0].defaults[0].pageKey").value("governance-report"))
            .andExpect(jsonPath("$.data.pageSkills[0].defaults[0].defaultAgent.agentKind").value("knowledge-governance"))
            .andExpect(jsonPath("$.data.pageSkills[0].defaults[1].pageKey").value("knowledge"))
            .andExpect(jsonPath("$.data.admittedEntrances[0].pageKey").value("knowledge"))
            .andExpect(jsonPath("$.data.registeredSkills[0].name").value("knowledge-governance"));
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

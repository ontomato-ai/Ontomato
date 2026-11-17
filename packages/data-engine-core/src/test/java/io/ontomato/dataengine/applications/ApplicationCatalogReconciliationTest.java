package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.service.IdentityService;
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

    @BeforeEach void setup() {
        new ApplicationCatalogUpgrade(jdbc).afterPropertiesSet();
        catalog = new ApplicationCatalog(jdbc,
            new TransactionTemplate(new DataSourceTransactionManager(dataSource)), mock(ApplicationAccess.class), "{}");
        http = MockMvcBuilders.standaloneSetup(new ApplicationController(catalog, mock(IdentityService.class),
            new WorkbenchServiceAuthentication("test-service")))
            .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    }
    private ApplicationCatalog.Builtin builtin(String id, String kind) {
        return new ApplicationCatalog.Builtin(id, kind, "apps", "build", 1,
            JSONObject.of("path", "/"+id, "renderer", id), List.of("domain-member"), null,
            new ApplicationCatalog.Declaration(Map.of("en", id), Map.of(), "pages", List.of(), List.of(), List.of()));
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
}

package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.controller.KnowledgeGovernanceController;
import io.ontomato.dataengine.controller.OntologyAgentErrors;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.service.agent.*;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class OssGovernanceWindowAssemblyTest {
  private final String schema="oss_governance_"+UUID.randomUUID().toString().replace("-", "");
  private final String record=UUID.randomUUID().toString(),session=UUID.randomUUID().toString(),run=UUID.randomUUID().toString();
  private JdbcTemplate jdbc;
  private AnnotationConfigApplicationContext context;
  private QueryGrantService grants;
  private MockMvc http;

  @BeforeEach void assemble() {
    String url=System.getenv("ONTOMATO_TEST_POSTGRES_URL");
    if(url==null || url.isBlank())throw new IllegalStateException("Set ONTOMATO_TEST_POSTGRES_URL to a disposable PostgreSQL database");
    var source=new DriverManagerDataSource(url,System.getenv("ONTOMATO_TEST_POSTGRES_USER"),System.getenv("ONTOMATO_TEST_POSTGRES_PASSWORD"));
    new JdbcTemplate(source).execute("CREATE SCHEMA "+schema);
    var properties=new java.util.Properties();properties.setProperty("currentSchema",schema+",public");source.setConnectionProperties(properties);
    jdbc=new JdbcTemplate(source);
    var store=new OntologyAgentStore(jdbc,new DataSourceTransactionManager(source));store.initialize();
    grants=new QueryGrantService(jdbc,"test-signing",new WorkbenchServiceAuthentication("service"));grants.initialize();
    var definitions=mock(OntologyAgentDefinitions.class);when(definitions.resource(anyString())).thenCallRealMethod();
    context=new AnnotationConfigApplicationContext();
    var beans=context.getBeanFactory();
    beans.registerSingleton("ontologyAgentStore",store);
    beans.registerSingleton("queryGrantService",grants);
    beans.registerSingleton("agentRuntimeClient",mock(AgentRuntimeClient.class));
    beans.registerSingleton("governanceRuntimeClient",mock(GovernanceRuntimeClient.class));
    beans.registerSingleton("ontologyAgentDefinitions",definitions);
    beans.registerSingleton("knowledgeService",mock(KnowledgeService.class));
    beans.registerSingleton("adminService",mock(AdminService.class));
    beans.registerSingleton("queryAccessService",mock(QueryAccessService.class));
    context.register(AnonymousIdentityService.class,AnonymousScheduleIdentity.class,KnowledgeGovernanceService.class,
      OntologyAgentAccess.class,KnowledgeGovernanceController.class);
    context.refresh();
    http=MockMvcBuilders.standaloneSetup(context.getBean(KnowledgeGovernanceController.class))
      .setControllerAdvice(new OntologyAgentErrors()).setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
  }
  @AfterEach void cleanup() {
    if(context!=null)context.close();
    if(jdbc!=null)jdbc.execute("DROP SCHEMA "+schema+" CASCADE");
  }
  private String binding(String owner) {
    return JSONObject.of("recordId",record,"domainId","1","ownerId",owner,"runtimeHostId","workbench",
      "sessionId",session,"runId",run,"expiresAt",Instant.now().plusSeconds(900).toString()).toJSONString();
  }
  @Test void nodeSystemIdentityRegistersButJavaKeepsItsAdminOwnerAndGrant() throws Exception {
    var response=http.perform(post("/ontology/ai/knowledge-governance/platform-windows")
      .header("X-Ontomato-Query-Service-Token","service").contentType(MediaType.APPLICATION_JSON).content(binding("system")))
      .andExpect(status().isOk()).andReturn().getResponse();
    var result=JSONObject.parseObject(response.getContentAsString());
    assertEquals(record,result.getString("id"));
    var stored=jdbc.queryForMap("SELECT owner_id,domain_id FROM ontology_governance_records WHERE id=?::uuid",record);
    assertEquals("admin",stored.get("owner_id"));assertEquals("1",stored.get("domain_id"));
    var grant=grants.verify(result.getString("token"),run,"/ontology/ai/knowledge-governance/"+record+"/runs/"+run+"/actions/read_work_record");
    assertEquals("admin",grant.getString("userId"));assertEquals("1",grant.getString("domainId"));
  }
  @Test void anotherWorkbenchOwnerIsRejectedWithoutCreatingARecord() throws Exception {
    http.perform(post("/ontology/ai/knowledge-governance/platform-windows")
      .header("X-Ontomato-Query-Service-Token","service").contentType(MediaType.APPLICATION_JSON).content(binding("other-owner")))
      .andExpect(status().isNotFound());
    assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM ontology_governance_records",Integer.class));
  }
}

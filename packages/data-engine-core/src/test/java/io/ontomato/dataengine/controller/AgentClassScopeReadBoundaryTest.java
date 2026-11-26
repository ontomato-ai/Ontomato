package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.schedules.ScheduleJson.object;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.config.BaseControllerAdvice;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.DataService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.OntologyModelService;
import io.ontomato.dataengine.service.OntologyModelService.AttributeView;
import io.ontomato.dataengine.service.OntologyModelService.DeletionImpact;
import io.ontomato.dataengine.service.OntologyModelService.FormDescription;
import io.ontomato.dataengine.service.OntologyModelService.FormSave;
import io.ontomato.dataengine.service.OntologyModelService.ObjectTypeView;
import io.ontomato.dataengine.service.OntologyModelService.RelationshipView;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.agent.AgentExecutionScope;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.agent.OntologyAgentAccess;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SpringBeanUtil;

/**
 * Verifies that generic data and model read endpoints enforce the active agent turn's class scope
 * while leaving human users and unrestricted agents unaffected.
 */
class AgentClassScopeReadBoundaryTest {

	private static final String CALLER_HEADER = "X-Ontomato-Retrieval-Caller-Id";
	private static final String SCOPED_CALLER = "11111111-1111-1111-1111-111111111111";
	private static final String UNRESTRICTED_CALLER = "22222222-2222-2222-2222-222222222222";
	private static final String CLOSED_CALLER = "33333333-3333-3333-3333-333333333333";

	private OntologyAgentAccess agentAccess;
	private DataService dataService;
	private OntologyModelService modelService;
	private User user;
	private UserDataPermission permission;
	private MockMvc dataMvc;
	private MockMvc modelMvc;

	@BeforeEach
	void setUp() {
		agentAccess = mock(OntologyAgentAccess.class);
		dataService = mock(DataService.class);
		modelService = mock(OntologyModelService.class);
		user = new QueryAccessService.GrantUser("exec-user", "domain-a");
		permission = new UserDataPermission();
		permission.setFullData(true);

		IdentityService identityService = mock(IdentityService.class);
		when(identityService.getCurrentUser()).thenReturn(user);
		when(identityService.getCurrentUserDataPermission()).thenReturn(permission);
		GenericApplicationContext context = new GenericApplicationContext();
		context.registerBean(IdentityService.class, () -> identityService);
		context.refresh();
		new SpringBeanUtil().setApplicationContext(context);

		long callerDeadline = System.currentTimeMillis() + 60_000;
		when(agentAccess.scopedQuery(any(), eq(SCOPED_CALLER))).thenReturn(
				new QueryAccessService.Access(user, permission, null, null, callerDeadline, List.of("Order", "Item"))
						.withExecution(user.getId(), user.getId()));
		when(agentAccess.scopedQuery(any(), eq(UNRESTRICTED_CALLER))).thenReturn(
				new QueryAccessService.Access(user, permission, null, null, callerDeadline, List.of())
						.withExecution(user.getId(), user.getId()));
		when(agentAccess.scopedQuery(any(), eq(CLOSED_CALLER)))
				.thenThrow(new AgentHttpException(409, "RETRIEVAL_RUN_CLOSED", "Caller is closed"));

		AgentExecutionScope scope = new AgentExecutionScope(agentAccess);

		DataController dataController = new DataController(scope);
		ReflectionTestUtils.setField(dataController, "identityService", identityService);
		ReflectionTestUtils.setField(dataController, "dataService", dataService);
		dataMvc = MockMvcBuilders.standaloneSetup(dataController)
				.setControllerAdvice(new BaseControllerAdvice())
				.setMessageConverters(new MappingJackson2HttpMessageConverter())
				.build();

		OntologyModelController modelController = new OntologyModelController(scope);
		ReflectionTestUtils.setField(modelController, "identityService", identityService);
		ReflectionTestUtils.setField(modelController, "service", modelService);
		modelMvc = MockMvcBuilders.standaloneSetup(modelController)
				.setMessageConverters(new MappingJackson2HttpMessageConverter())
				.build();
	}

	@Test
	void dataPaginatedReadsEnforceAgentClassScope() throws Exception {
		JSONObject ok = JSONObject.of("success", true, "data", List.of(), "total_count", 0);
		when(dataService.getWholeClassDataByPage(any(), eq("en"), eq(permission), eq("domain-a"))).thenReturn(ok);
		when(dataService.getClassDataByPage(any(), eq("en"), eq(permission), eq("domain-a"))).thenReturn(ok);

		// Scoped agent reading an allowed class succeeds.
		dataMvc.perform(post("/data/getWholeClassDataByPage")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"classname":"Order","pagenum":1,"pagecount":20}
						"""))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.success").value(true));

		// Scoped agent reading an excluded class or omitting classname is rejected with 403.
		dataMvc.perform(post("/data/getWholeClassDataByPage")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"classname":"Customer","pagenum":1,"pagecount":20}
						"""))
				.andExpect(status().isForbidden());

		dataMvc.perform(post("/data/getWholeClassDataByPage")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"pagenum":1,"pagecount":20}
						"""))
				.andExpect(status().isForbidden());

		dataMvc.perform(post("/data/getclassdatabypage")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"classname":"Customer","pagenum":1,"pagecount":20}
						"""))
				.andExpect(status().isForbidden());

		dataMvc.perform(post("/data/getclassdatabypage")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"classname":"Order","pagenum":1,"pagecount":20}
						"""))
				.andExpect(status().isOk());

		// Unrestricted agent and normal human user are unaffected.
		dataMvc.perform(post("/data/getWholeClassDataByPage")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, UNRESTRICTED_CALLER)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"classname":"Customer","pagenum":1,"pagecount":20}
						"""))
				.andExpect(status().isOk());

		dataMvc.perform(post("/data/getWholeClassDataByPage")
				.header("Accept-Language", "en")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"classname":"Customer","pagenum":1,"pagecount":20}
						"""))
				.andExpect(status().isOk());
	}

	@Test
	void dataNodeDistinctAndWholeDomainReadsEnforceAgentClassScope() throws Exception {
		JSONObject ok = JSONObject.of("success", true, "data", JSONObject.of());
		when(dataService.queryInfoByNode(any(), eq("en"), eq(permission), eq("domain-a"))).thenReturn(ok);
		when(dataService.queryDistinctAttrValue(any(), any(), any(), eq(permission), eq("domain-a")))
				.thenReturn(List.of("v1"));
		when(dataService.fullTextSearch(any(), eq("en"), eq(permission), eq("domain-a"))).thenReturn(ok);
		when(dataService.getClassAndCount(eq("en"), eq(permission), eq("domain-a"))).thenReturn(ok);

		// Single-node detail read: allowed class passes, excluded class is rejected.
		dataMvc.perform(post("/data/queryInfoByNode")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"class":"Order","id":"Order:1"}
						"""))
				.andExpect(status().isOk());

		dataMvc.perform(post("/data/queryInfoByNode")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"class":"Customer","id":"Customer:1"}
						"""))
				.andExpect(status().isForbidden());

		// Distinct attribute value read: excluded class returns 403 instead of being swallowed.
		dataMvc.perform(post("/data/queryDistinctAttrValue")
				.header(CALLER_HEADER, SCOPED_CALLER)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"className":"Customer","attrName":"email","query":""}
						"""))
				.andExpect(status().isForbidden());

		dataMvc.perform(post("/data/queryDistinctAttrValue")
				.header(CALLER_HEADER, SCOPED_CALLER)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"className":"Order","attrName":"status","query":""}
						"""))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.success").value(true));

		// Whole-domain scans are rejected for class-scoped agents and allowed for human/unrestricted callers.
		dataMvc.perform(post("/data/fulltextsearch")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"term":"abc","limit":10}
						"""))
				.andExpect(status().isForbidden());

		dataMvc.perform(get("/data/getclassandcount")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER))
				.andExpect(status().isForbidden());

		dataMvc.perform(post("/data/fulltextsearch")
				.header("Accept-Language", "en")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"term":"abc","limit":10}
						"""))
				.andExpect(status().isOk());

		dataMvc.perform(get("/data/getclassandcount")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, UNRESTRICTED_CALLER))
				.andExpect(status().isOk());

		verify(dataService, never()).queryDistinctAttrValue(eq("Customer"), any(), any(), any(), any());
	}

	@Test
	void ontologyModelAttributesAndObjectTypeReadsEnforceAgentClassScope() throws Exception {
		AttributeView orderAttr = new AttributeView("Order", "order_id", "Order ID", "varchar", "", true, true, true);
		AttributeView customerAttr = new AttributeView("Customer", "email", "Email", "varchar", "", true, false, false);
		ObjectTypeView orderType = new ObjectTypeView("Order", "Order", "", 1, 1, 0, Map.of("status", "ok"), List.of());
		ObjectTypeView customerType = new ObjectTypeView("Customer", "Customer", "", 1, 0, 0, Map.of("status", "ok"), List.of());

		String domain = user.getDomainId();
		when(modelService.attributes(eq("Order"), eq(domain), eq("en"))).thenReturn(List.of(orderAttr));
		when(modelService.attributes(eq("Customer"), eq(domain), eq("en"))).thenReturn(List.of(customerAttr));
		when(modelService.attributes(eq(null), eq(domain), eq("en"))).thenReturn(List.of(orderAttr, customerAttr));
		when(modelService.objectTypes(eq(domain), eq("en"))).thenReturn(List.of(orderType, customerType));
		when(modelService.objectType(eq("Order"), eq(domain), eq("en"))).thenReturn(orderType);
		when(modelService.objectType(eq("Customer"), eq(domain), eq("en"))).thenReturn(customerType);
		when(modelService.deletionImpact(eq("Order"), eq(user), eq("en"))).thenReturn(new DeletionImpact(List.of()));

		// Scoped agent reading allowed class attributes succeeds.
		modelMvc.perform(get("/ontology/model/attributes")
				.param("className", "Order")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$[0].className").value("Order"));

		// Scoped agent reading excluded class attributes is rejected with 403 before calling the service.
		modelMvc.perform(get("/ontology/model/attributes")
				.param("className", "Customer")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
		verify(modelService, never()).attributes(eq("Customer"), eq(domain), eq("en"));

		// Unfiltered attributes and object-types lists are filtered to the caller's class scope.
		var filteredAttrs = JSON.parseArray(modelMvc.perform(get("/ontology/model/attributes")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER))
				.andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
		assertEquals(1, filteredAttrs.size());
		assertEquals("Order", filteredAttrs.getJSONObject(0).getString("className"));

		var filteredTypes = JSON.parseArray(modelMvc.perform(get("/ontology/model/object-types")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER))
				.andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
		assertEquals(1, filteredTypes.size());
		assertEquals("Order", filteredTypes.getJSONObject(0).getString("className"));

		// Single object-type and deletion-impact reads reject excluded classes and allow in-scope classes.
		modelMvc.perform(get("/ontology/model/object-type")
				.param("className", "Order")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER))
				.andExpect(status().isOk());

		modelMvc.perform(get("/ontology/model/object-type")
				.param("className", "Customer")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER))
				.andExpect(status().isForbidden());

		modelMvc.perform(get("/ontology/model/object-type/deletion-impact")
				.param("className", "Customer")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER))
				.andExpect(status().isForbidden());

		modelMvc.perform(get("/ontology/model/object-type/deletion-impact")
				.param("className", "Order")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER))
				.andExpect(status().isOk());

		// Unrestricted agent and normal human user keep full read access.
		modelMvc.perform(get("/ontology/model/attributes")
				.param("className", "Customer")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, UNRESTRICTED_CALLER))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$[0].className").value("Customer"));

		var humanTypes = JSON.parseArray(modelMvc.perform(get("/ontology/model/object-types")
				.header("Accept-Language", "en"))
				.andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
		assertEquals(2, humanTypes.size());

		// Closed/expired agent callers return their real HTTP status instead of 500.
		modelMvc.perform(get("/ontology/model/attributes")
				.param("className", "Order")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, CLOSED_CALLER))
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.error.code").value("RETRIEVAL_RUN_CLOSED"));
	}

	@Test
	void ontologyModelRelationshipAndFormReadsEnforceAgentClassScope() throws Exception {
		RelationshipView inScope = new RelationshipView(
				"order_item", "Order", "Item", "", "id", "order_id", "Order", "Item");
		RelationshipView crossScope = new RelationshipView(
				"order_customer", "Order", "Customer", "", "customer_id", "id", "Order", "Customer");
		FormDescription emptyForm = new FormDescription(
				List.of(), Map.of(), new FormSave("POST", "/ontology/model/object-type/update", object("type", "object")));

		String domain = user.getDomainId();
		when(modelService.relationships(eq("Order"), eq(domain), eq("en"))).thenReturn(List.of(inScope, crossScope));
		when(modelService.relationships(eq(null), eq(domain), eq("en"))).thenReturn(List.of(inScope, crossScope));
		when(modelService.relationship(eq("order_item"), eq(domain), eq("en"))).thenReturn(inScope);
		when(modelService.relationship(eq("order_customer"), eq(domain), eq("en"))).thenReturn(crossScope);
		when(modelService.objectTypeForm(any(), eq(domain), eq("en"))).thenReturn(emptyForm);
		when(modelService.attributeForm(any(), eq(domain), eq("en"))).thenReturn(emptyForm);
		when(modelService.relationshipForm(any(), eq(domain), eq("en"))).thenReturn(emptyForm);

		// Excluded class filter on relationships is rejected; in-scope class filter hides cross-scope edges.
		modelMvc.perform(get("/ontology/model/relationships")
				.param("className", "Customer")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER))
				.andExpect(status().isForbidden());

		var orderRelations = JSON.parseArray(modelMvc.perform(get("/ontology/model/relationships")
				.param("className", "Order")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER))
				.andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
		assertEquals(1, orderRelations.size());
		assertEquals("order_item", orderRelations.getJSONObject(0).getString("relationship"));

		// Single relationship read requires both endpoints to be inside the caller's class scope.
		modelMvc.perform(get("/ontology/model/relationship")
				.param("relationship", "order_item")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER))
				.andExpect(status().isOk());

		modelMvc.perform(get("/ontology/model/relationship")
				.param("relationship", "order_customer")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER))
				.andExpect(status().isForbidden());

		// Form reads targeting excluded classes or relationships are rejected for scoped agents.
		modelMvc.perform(post("/ontology/model/object-type/form")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"target":{"kind":"object","objectType":"platform:ObjectType","primaryKey":"Customer"},
						"values":{},"changedField":null}
						"""))
				.andExpect(status().isForbidden());

		modelMvc.perform(post("/ontology/model/attribute/form")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"target":{"kind":"object","objectType":"platform:Attribute","primaryKey":"[\\"Customer\\",\\"email\\"]"},
						"values":{},"changedField":null}
						"""))
				.andExpect(status().isForbidden());

		modelMvc.perform(post("/ontology/model/relationship/form")
				.header("Accept-Language", "en")
				.header(CALLER_HEADER, SCOPED_CALLER)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"target":{"kind":"object","objectType":"platform:Relationship","primaryKey":"order_customer"},
						"values":{},"changedField":null}
						"""))
				.andExpect(status().isForbidden());

		// Human user reading the cross-scope relationship is unaffected and never invokes agent scope lookup.
		modelMvc.perform(get("/ontology/model/relationship")
				.param("relationship", "order_customer")
				.header("Accept-Language", "en"))
				.andExpect(status().isOk());

		verify(modelService, never()).objectTypeForm(any(), any(), any());
		verify(modelService, never()).attributeForm(any(), any(), any());
		verify(modelService, never()).relationshipForm(any(), any(), any());
	}

	@Test
	void humanModelReadsDoNotInvokeAgentExecutionScope() throws Exception {
		when(modelService.attributes(eq("Customer"), eq(user.getDomainId()), eq("en")))
				.thenReturn(List.of(new AttributeView("Customer", "email", "Email", "varchar", "", true, false, false)));

		modelMvc.perform(get("/ontology/model/attributes")
				.param("className", "Customer")
				.header("Accept-Language", "en"))
				.andExpect(status().isOk());

		verifyNoInteractions(agentAccess);
	}
}

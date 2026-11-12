package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.config.multisource.DataSourceEntry;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dataAdapter.DataAdapterConnection;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.dataAdapter.FakeDataAdapterProvider;
import io.ontomato.dataengine.dataAdapter.MultiDataSourceAdapterProvider;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.util.SpringBeanUtil;

/** Saving a multi-source definition: checked on its own and against the domain's ontomap before anything is saved. */
class BusinessConfigControllerMultiDataSourceTest {

	private final BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
	private final AdminService adminService = mock(AdminService.class);
	private final BusinessConfig businessConfig = new BusinessConfig();
	private final BusinessConfigController controller = new BusinessConfigController();
	private final DataAdapterConnection singleSource = new DataAdapterConnection();

	@BeforeEach
	void setUp() throws Exception {
		User user = mock(User.class);
		when(user.getDomainId()).thenReturn("d1");
		IdentityService identityService = mock(IdentityService.class);
		when(identityService.getCurrentUser()).thenReturn(user);
		GenericApplicationContext context = new GenericApplicationContext();
		context.registerBean(IdentityService.class, () -> identityService);
		context.refresh();
		new SpringBeanUtil().setApplicationContext(context);

		singleSource.put("url", "jdbc:postgresql://single/db");
		businessConfig.setDataAdapter("postgresql");
		businessConfig.getDataAdapterConnections().put("postgresql", singleSource);
		when(businessConfigService.get("d1")).thenReturn(businessConfig);

		MultiDataSourceAdapterProvider multi = new MultiDataSourceAdapterProvider();
		DataAdapterRegistry registry = new DataAdapterRegistry(List.of(
				new FakeDataAdapterProvider("postgresql", "PostgreSQL", List.of("url", "user", "password")),
				new FakeDataAdapterProvider("duckdb", "DuckDB", List.of("url")),
				multi), new DataRagConfig());
		ReflectionTestUtils.setField(multi, "registry", registry);
		ReflectionTestUtils.setField(controller, "businessConfigService", businessConfigService);
		ReflectionTestUtils.setField(controller, "dataAdapterRegistry", registry);
		ReflectionTestUtils.setField(controller, "adminService", adminService);
		when(adminService.getJSONRule("d1")).thenReturn(ontomap());
	}

	private static JSONObject ontomap() {
		return new JSONObject()
				.fluentPut("classDef", JSONArray.of(new JSONObject().fluentPut("className", "Person"),
						new JSONObject().fluentPut("className", "Invoice")))
				.fluentPut("relationship_rule", new JSONObject().fluentPut("person_invoice",
						new JSONObject().fluentPut("fromclass", "Person").fluentPut("toclass", "Invoice")));
	}

	private static JSONObject source(String id, String type, JSONObject connection) {
		return new JSONObject().fluentPut("id", id).fluentPut("label", id).fluentPut("adapterType", type)
				.fluentPut("readOnly", false).fluentPut("connection", connection);
	}

	private static JSONObject route(String className, String sourceId) {
		return new JSONObject().fluentPut("forOntoMap", className).fluentPut("sourceId", sourceId);
	}

	private static JSONObject definition(String invoiceSource) {
		return new JSONObject()
				.fluentPut("dataSources", JSONArray.of(
						source("crm", "postgresql", new JSONObject().fluentPut("url", "jdbc:postgresql://crm/db")
								.fluentPut("user", "u").fluentPut("password", "p").fluentPut("company", "ignored")),
						source("files", "duckdb", new JSONObject().fluentPut("url", "jdbc:duckdb:/data/f.duckdb")
								.fluentPut("user", "ignored"))))
				.fluentPut("classes", JSONArray.of(route("Person", "crm"), route("Invoice", invoiceSource)))
				.fluentPut("relationships", new JSONArray());
	}

	@Test
	void savesAValidDefinitionAndSwitchesTheDomainToMulti() {
		JSONObject ret = controller.useMultiDataSource(definition("crm"));

		assertTrue(ret.getBooleanValue("success"), ret.toJSONString());
		verify(businessConfigService).set(businessConfig, "d1");
		assertEquals("multi", businessConfig.getDataAdapter());
		List<DataSourceEntry> sources = businessConfig.getMultiDataSource().getDataSources();
		assertEquals("jdbc:postgresql://crm/db", sources.get(0).getConnection().get("url"));
		assertNull(sources.get(0).getConnection().get("company"), "an undeclared connection field is not kept");
		assertNull(sources.get(1).getConnection().get("user"), "an undeclared connection field is not kept");
		assertEquals(Map.of("postgresql", singleSource), businessConfig.getDataAdapterConnections(),
				"the single-source connections are left untouched");
	}

	@Test
	void rejectsAnOntomapItCannotHonourWithLocatedProblemsAndSavesNothing() {
		JSONObject ret = controller.useMultiDataSource(definition("files"));

		assertFalse(ret.getBooleanValue("success"));
		List<JSONObject> problems = JSON.parseObject(ret.toJSONString()).getJSONObject("data")
				.getJSONArray("problems").toJavaList(JSONObject.class);
		JSONObject crossSource = problems.stream()
				.filter(problem -> "relationship_rule[person_invoice]".equals(problem.getString("path")))
				.findFirst().orElseThrow(() -> new AssertionError(ret.toJSONString()));
		assertTrue(crossSource.getString("detail").contains("crosses data sources"));
		verify(businessConfigService, never()).set(any(), anyString());
	}

	@Test
	void rejectsAnInvalidDefinitionBeforeLookingAtTheOntomap() {
		JSONObject body = definition("crm");
		body.getJSONArray("classes").add(route("Person", "nowhere"));

		JSONObject ret = controller.useMultiDataSource(body);

		assertFalse(ret.getBooleanValue("success"));
		List<JSONObject> problems = JSON.parseObject(ret.toJSONString()).getJSONObject("data")
				.getJSONArray("problems").toJavaList(JSONObject.class);
		assertTrue(problems.stream().anyMatch(problem -> "classes[Person]".equals(problem.getString("path"))
				&& problem.getString("detail").contains("unknown source")), ret.toJSONString());
		verify(businessConfigService, never()).set(any(), anyString());
	}

	@Test
	void theSingleSourceEndpointRefusesTheMultiType() {
		JSONObject ret = controller.useDataAdapter(new JSONObject().fluentPut("type", "multi"));

		assertFalse(ret.getBooleanValue("success"));
		assertTrue(ret.getString("message").contains("useMultiDataSource"), ret.getString("message"));
		assertEquals("postgresql", businessConfig.getDataAdapter());
		verify(businessConfigService, never()).set(any(), anyString());
	}
}

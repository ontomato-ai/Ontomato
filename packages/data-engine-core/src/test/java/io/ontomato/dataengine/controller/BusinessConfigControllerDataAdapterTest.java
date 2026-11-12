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
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dataAdapter.DataAdapterConnection;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.dataAdapter.FakeDataAdapterProvider;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.util.SpringBeanUtil;

class BusinessConfigControllerDataAdapterTest {

	private final BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
	private final BusinessConfig businessConfig = new BusinessConfig();
	private final BusinessConfigController controller = new BusinessConfigController();

	@BeforeEach
	void setUp() {
		User user = mock(User.class);
		when(user.getDomainId()).thenReturn("d1");
		IdentityService identityService = mock(IdentityService.class);
		when(identityService.getCurrentUser()).thenReturn(user);
		GenericApplicationContext context = new GenericApplicationContext();
		context.registerBean(IdentityService.class, () -> identityService);
		context.refresh();
		new SpringBeanUtil().setApplicationContext(context);

		businessConfig.setDataAdapter("postgresql");
		when(businessConfigService.get("d1")).thenReturn(businessConfig);
		DataAdapterRegistry registry = new DataAdapterRegistry(List.of(
				new FakeDataAdapterProvider("postgresql", "PostgreSQL", List.of("url", "user", "password"),
						Map.of("url", "jdbc:postgresql://host:port/db", "user", "postgres")),
				new FakeDataAdapterProvider("duckdb", "DuckDB", List.of("url"), Map.of("url", "jdbc:duckdb:/data/example.duckdb")),
				new FakeDataAdapterProvider("m3", "M3", List.of("url", "company", "user", "password"),
						Map.of("url", "192.0.2.72:8080"))), new DataRagConfig());
		ReflectionTestUtils.setField(controller, "businessConfigService", businessConfigService);
		ReflectionTestUtils.setField(controller, "dataAdapterRegistry", registry);
	}

	@Test
	void dataAdaptersGivesTheDomainsCurrentTypeAndTheInstalledOnesByLabelWithoutConnections() {
		DataAdapterConnection saved = new DataAdapterConnection();
		saved.put("url", "jdbc:postgresql://db.internal:5432/prod");
		saved.put("user", "prod-user");
		saved.put("password", "SECRET-DB-PASSWORD");
		businessConfig.getDataAdapterConnections().put("postgresql", saved);

		JSONObject ret = controller.dataAdapters();

		assertTrue(ret.getBooleanValue("success"));
		JSONObject data = ret.getJSONObject("data");
		assertTrue(data.containsKey("currentType") && data.containsKey("adapters"), data.keySet().toString());
		assertEquals("postgresql", data.getString("currentType"));
		String body = JSON.toJSONString(ret);
		assertFalse(body.contains("SECRET-DB-PASSWORD"), body);
		assertFalse(body.contains("db.internal"), body);
		assertFalse(body.contains("prod-user"), body);
		// Every installed adapter is described, with its declared fields and the password marked secret.
		List<JSONObject> described = data.getJSONArray("adapters").toJavaList(JSONObject.class);
		assertEquals(java.util.Set.of("duckdb", "m3", "postgresql"),
				described.stream().map(adapter -> adapter.getString("type")).collect(java.util.stream.Collectors.toSet()));
		JSONObject m3 = described.stream().filter(adapter -> "m3".equals(adapter.getString("type"))).findFirst().orElseThrow();
		assertEquals("M3", m3.getString("label"));
		List<JSONObject> m3Fields = m3.getJSONArray("fieldInfos").toJavaList(JSONObject.class);
		assertEquals(List.of("url", "company", "user", "password"),
				m3Fields.stream().map(field -> field.getString("name")).toList());
		assertFalse(m3Fields.get(0).getBooleanValue("secret"), m3.toString());
		assertTrue(m3Fields.get(3).getBooleanValue("secret"), m3.toString());
	}

	@Test
	void useDataAdapterSavesOnlyTheDeclaredFieldsAndSelectsTheType() {
		JSONObject ret = controller.useDataAdapter(JSON.parseObject(
				"{\"type\":\"duckdb\",\"url\":\"jdbc:duckdb:/data/a.db\",\"user\":\"u\",\"password\":\"p\"}"));

		assertTrue(ret.getBooleanValue("success"), ret.toJSONString());
		assertEquals("duckdb", businessConfig.getDataAdapter());
		DataAdapterConnection connection = businessConfig.getDataAdapterConnections().get("duckdb");
		assertEquals("jdbc:duckdb:/data/a.db", connection.get("url"));
		assertNull(connection.get("user"));
		assertNull(connection.get("password"));
		verify(businessConfigService).set(businessConfig, "d1");
	}

	@Test
	void useDataAdapterSavesTheCompanyOfAnAdapterThatDeclaresIt() {
		JSONObject ret = controller.useDataAdapter(JSON.parseObject(
				"{\"type\":\"m3\",\"url\":\"m3.test:8080\",\"company\":\"acme\",\"user\":\"admin\",\"password\":\"pw\"}"));

		// Design 5: M3's connection is saved per domain like any other adapter's.
		assertTrue(ret.getBooleanValue("success"), ret.toJSONString());
		assertEquals("m3", businessConfig.getDataAdapter());
		DataAdapterConnection connection = businessConfig.getDataAdapterConnections().get("m3");
		assertEquals("m3.test:8080", connection.get("url"));
		assertEquals("acme", connection.get("company"));
		assertEquals("admin", connection.get("user"));
		assertEquals("pw", connection.get("password"));
	}

	@Test
	void useDataAdapterRejectsATypeThisEditionDoesNotInstall() {
		JSONObject ret = controller.useDataAdapter(JSON.parseObject("{\"type\":\"oracle\",\"url\":\"jdbc:oracle\"}"));

		assertFalse(ret.getBooleanValue("success"));
		assertTrue(ret.getString("message").contains("oracle"), ret.getString("message"));
		assertTrue(ret.getString("message").contains("Data adapter not installed in this edition"), ret.getString("message"));
		assertEquals("postgresql", businessConfig.getDataAdapter());
		verify(businessConfigService, never()).set(any(), anyString());
	}
}

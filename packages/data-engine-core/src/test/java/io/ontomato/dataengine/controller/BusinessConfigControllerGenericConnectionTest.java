package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
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
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dataAdapter.DataAdapterConnection;
import io.ontomato.dataengine.dataAdapter.DataAdapterConnectionField;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.dataAdapter.FakeDataAdapterProvider;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.util.SpringBeanUtil;

class BusinessConfigControllerGenericConnectionTest {

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

		businessConfig.setDataAdapter("snowflake");
		when(businessConfigService.get("d1")).thenReturn(businessConfig);

		DataAdapterRegistry registry = new DataAdapterRegistry(List.of(
				new FakeDataAdapterProvider("snowflake", "Snowflake",
						List.of("url", "account", "warehouse", "role", "database", "schema", "user", "password"),
						Map.of("url", "jdbc:snowflake://acct", "account", "acct")),
				new RequiredProvider()), new DataRagConfig());
		ReflectionTestUtils.setField(controller, "sandboxPermissions", mock(io.ontomato.dataengine.service.SandboxPermissionService.class));
		ReflectionTestUtils.setField(controller, "businessConfigService", businessConfigService);
		ReflectionTestUtils.setField(controller, "dataAdapterRegistry", registry);
	}

	@Test
	void savesEveryFieldAnAdapterDeclaresWithoutKnowingTheirNames() {
		JSONObject ret = controller.useDataAdapter(JSON.parseObject(
				"{\"type\":\"snowflake\","
						+ "\"url\":\"jdbc:snowflake://acct\","
						+ "\"account\":\"acct\","
						+ "\"warehouse\":\"WH\","
						+ "\"role\":\"ANALYST\","
						+ "\"database\":\"ANALYTICS\","
						+ "\"schema\":\"PUBLIC\","
						+ "\"user\":\"svc\","
						+ "\"password\":\"pw\"}"));

		assertTrue(ret.getBooleanValue("success"), ret.toJSONString());
		DataAdapterConnection connection = businessConfig.getDataAdapterConnections().get("snowflake");
		assertEquals(8, connection.size());
		assertEquals("jdbc:snowflake://acct", connection.get("url"));
		assertEquals("acct", connection.get("account"));
		assertEquals("WH", connection.get("warehouse"));
		assertEquals("ANALYST", connection.get("role"));
		assertEquals("ANALYTICS", connection.get("database"));
		assertEquals("PUBLIC", connection.get("schema"));
		assertEquals("svc", connection.get("user"));
		assertEquals("pw", connection.get("password"));
	}

	@Test
	void acceptsTheNestedPropertiesShapeAsACompatibilityPath() {
		JSONObject ret = controller.useDataAdapter(JSON.parseObject(
				"{\"type\":\"snowflake\",\"url\":\"jdbc:snowflake://acct\","
						+ "\"properties\":{\"account\":\"acct\",\"warehouse\":\"WH\"}}"));

		assertTrue(ret.getBooleanValue("success"), ret.toJSONString());
		DataAdapterConnection connection = businessConfig.getDataAdapterConnections().get("snowflake");
		assertEquals("acct", connection.get("account"));
		assertEquals("WH", connection.get("warehouse"));
	}

	@Test
	void rejectsAMissingRequiredField() {
		JSONObject ret = controller.useDataAdapter(JSON.parseObject(
				"{\"type\":\"required\",\"url\":\"jdbc:required\"}"));

		assertFalse(ret.getBooleanValue("success"));
		assertTrue(ret.getString("message").contains("token"), ret.getString("message"));
	}

	@Test
	void publishesFieldInfosWithLabelsRequiredAndSecret() {
		JSONObject ret = controller.dataAdapters();
		JSONArray adapters = ret.getJSONObject("data").getJSONArray("adapters");
		JSONObject snowflake = adapters.stream()
				.map(JSONObject.class::cast)
				.filter(adapter -> "snowflake".equals(adapter.getString("type")))
				.findFirst()
				.orElseThrow();

		JSONArray fieldInfos = snowflake.getJSONArray("fieldInfos");
		assertEquals(8, fieldInfos.size());
		assertEquals("url", fieldInfos.getJSONObject(0).getString("name"));
		assertEquals("account", fieldInfos.getJSONObject(1).getString("name"));
		assertTrue(fieldInfos.getJSONObject(7).getBooleanValue("secret"));
	}

	private static final class RequiredProvider extends FakeDataAdapterProvider {
		RequiredProvider() {
			super("required", "Required", List.of("url", "token"));
		}

		@Override
		public List<DataAdapterConnectionField> connectionFieldDefinitions() {
			return List.of(
					new DataAdapterConnectionField("url", "URL", true, false, null, false),
					new DataAdapterConnectionField("token", "Token", true, true, null, false));
		}
	}
}

package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Base64;
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
import io.ontomato.dataengine.config.multisource.DataSourceEntry;
import io.ontomato.dataengine.config.multisource.MultiDataSourceDefinition;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dataAdapter.ConnectionSecretCodec;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterConnection;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.dataAdapter.FakeDataAdapterProvider;
import io.ontomato.dataengine.dataAdapter.SecretCipher;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.util.SpringBeanUtil;

class BusinessConfigControllerSecretTest {

	private static final String KEY = Base64.getEncoder().encodeToString(new byte[32]);

	private final BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
	private final BusinessConfig businessConfig = new BusinessConfig();
	private final BusinessConfigController controller = new BusinessConfigController();
	private final FakeDataAdapterProvider postgres = new FakeDataAdapterProvider(
			"postgresql", "PostgreSQL", List.of("url", "user", "password"), Map.of()) {
		@Override
		public DataAdapter create(DataAdapterConnection connection, DataRagConfig config, Map<String, Object> rule) {
			var adapter = super.create(connection, config, rule);
			try {
				when(adapter.testConnection()).thenReturn(new JSONObject());
			} catch (Exception error) {
				throw new AssertionError(error);
			}
			return adapter;
		}
	};

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

		DataAdapterRegistry registry = new DataAdapterRegistry(List.of(postgres), new DataRagConfig());
		ConnectionSecretCodec codec = new ConnectionSecretCodec(
				registry, new SecretCipher(KEY, SecretCipher.Mode.DUAL));

		ReflectionTestUtils.setField(controller, "sandboxPermissions", mock(io.ontomato.dataengine.service.SandboxPermissionService.class));
		ReflectionTestUtils.setField(controller, "businessConfigService", businessConfigService);
		ReflectionTestUtils.setField(controller, "dataAdapterRegistry", registry);
		ReflectionTestUtils.setField(controller, "connectionSecretCodec", codec);

		DataAdapterConnection saved = new DataAdapterConnection();
		saved.put("url", "jdbc:postgresql://db");
		saved.put("user", "u");
		saved.put("password", "old-secret");
		businessConfig.getDataAdapterConnections().put("postgresql", saved);
	}

	@Test
	void getConfigMasksTheSavedPasswordWithoutMutatingTheStoredConfig() {
		JSONObject ret = controller.getConfig();
		JSONObject data = JSON.parseObject(JSON.toJSONString(ret.get("data")));
		String password = data.getJSONObject("dataAdapterConnections")
				.getJSONObject("postgresql").getString("password");

		assertEquals("******", password);
		assertEquals("old-secret", businessConfig.getDataAdapterConnections()
				.get("postgresql").get("password"));
	}

	@Test
	void savingAMaskedPasswordKeepsTheStoredSecret() {
		JSONObject ret = controller.useDataAdapter(JSON.parseObject(
				"{\"type\":\"postgresql\",\"url\":\"jdbc:postgresql://db\",\"user\":\"u\",\"password\":\"******\"}"));

		assertTrue(ret.getBooleanValue("success"), ret.toJSONString());
		assertEquals("old-secret", businessConfig.getDataAdapterConnections()
				.get("postgresql").get("password"));
	}

	@Test
	void savingARealPasswordReplacesTheStoredSecret() {
		JSONObject ret = controller.useDataAdapter(JSON.parseObject(
				"{\"type\":\"postgresql\",\"url\":\"jdbc:postgresql://db\",\"user\":\"u\",\"password\":\"new-secret\"}"));

		assertTrue(ret.getBooleanValue("success"), ret.toJSONString());
		assertEquals("new-secret", businessConfig.getDataAdapterConnections()
				.get("postgresql").get("password"));
		assertNotEquals("******", businessConfig.getDataAdapterConnections()
				.get("postgresql").get("password"));
	}

	@Test
	void testConnectionResolvesAMaskedPasswordFromTheStoredSecret() {
		controller.testDataAdapter(JSON.parseObject(
				"{\"type\":\"postgresql\",\"url\":\"jdbc:postgresql://db\",\"user\":\"u\",\"password\":\"******\"}"));

		assertEquals("old-secret", postgres.lastConnection.get("password"));
	}

	@Test
	void testConnectionResolvesAMaskedPasswordFromTheSelectedSourceOfTheSameType() {
		var primary = new DataSourceEntry();
		primary.setId("primary");
		primary.setAdapterType("postgresql");
		primary.getConnection().put("password", "primary-secret");
		var secondary = new DataSourceEntry();
		secondary.setId("secondary");
		secondary.setAdapterType("postgresql");
		secondary.getConnection().put("password", "secondary-secret");
		var multi = new MultiDataSourceDefinition();
		multi.setDataSources(List.of(primary, secondary));
		businessConfig.setDataAdapter("multi");
		businessConfig.setMultiDataSource(multi);

		var response = controller.testDataAdapter(JSONObject.of("type", "postgresql", "sourceId", "secondary",
				"url", "jdbc:postgresql://test", "user", "u", "password", "******"));

		assertTrue(response.getBooleanValue("success"), response.toJSONString());
		assertEquals("secondary-secret", postgres.lastConnection.get("password"));
		assertEquals("primary-secret", primary.getConnection().get("password"));
		assertEquals("secondary-secret", secondary.getConnection().get("password"));
	}
}

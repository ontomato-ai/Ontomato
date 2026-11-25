package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.impl.AdminServiceImpl;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

class JSONRuleAttributeTypesTest {
	private static final String ATTRIBUTES = """
			[
			  {"name":"id","type":"varchar","primaryKey":true},
			  {"name":"revision","type":"bigint"},
			  {"name":"updated_at","type":"datetime"},
			  {"name":"document","type":"vector"}
			]
			""";

	@Test
	void readsLegacyLedgerTypesWithoutRewritingStorage() {
		var jdbc = mock(JdbcTemplate.class);
		when(jdbc.queryForObject(anyString(), eq(String.class), eq("xingongV2")))
				.thenReturn("{\"classDef\":[{\"className\":\"workflow_run\",\"attrs\":" + ATTRIBUTES + "}]}");
		var dao = new JSONRuleDao();
		ReflectionTestUtils.setField(dao, "jdbcTemplate", jdbc);

		assertLedgerTypes(dao.query("xingongV2"));
		verify(jdbc, never()).update(anyString(), any(Object[].class));
	}

	@Test
	void normalizesImportedLedgerBeforeSavingAndRejectsUnknownTypes() {
		var dao = mock(JSONRuleDao.class);
		var admin = new AdminServiceImpl();
		ReflectionTestUtils.setField(admin, "jsonRuleDao", dao);
		var schema = "{\"classDefs\":[{\"name\":\"workflow_run\",\"attrs\":" + ATTRIBUTES + "}]}";

		admin.setPrettyJSONRule(JSONObject.parseObject(schema), "xingongV2");

		@SuppressWarnings("unchecked")
		ArgumentCaptor<Map<String, Object>> saved = ArgumentCaptor.forClass(Map.class);
		verify(dao).save(saved.capture(), eq("xingongV2"));
		assertLedgerTypes(saved.getValue());

		clearInvocations(dao);
		assertThrows(IllegalArgumentException.class, () ->
				admin.setPrettyJSONRule(JSONObject.parseObject(schema.replace("bigint", "geometry")), "xingongV2"));
		verifyNoInteractions(dao);
	}

	private static void assertLedgerTypes(Map<String, Object> rule) {
		var attributes = new JSONObject(rule).getJSONArray("classDef").getJSONObject(0).getJSONArray("attrs");
		assertEquals("long", attributes.getJSONObject(1).getString("type"));
		assertEquals("datetime", attributes.getJSONObject(2).getString("type"));
		assertEquals("vector", attributes.getJSONObject(3).getString("type"));
	}
}

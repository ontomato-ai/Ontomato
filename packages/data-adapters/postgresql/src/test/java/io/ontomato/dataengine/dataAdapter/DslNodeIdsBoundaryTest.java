package io.ontomato.dataengine.dataAdapter;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BaseControllerAdvice;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.controller.DslController;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.core.db.mql.MQLQuery.LogicQuery;
import io.ontomato.dataengine.core.db.mql.MQLQuery.PropertyQuery;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.impl.DslServiceImpl;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.HttpRequestUtil;
import io.ontomato.dataengine.util.SystemUtils;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class DslNodeIdsBoundaryTest {
	private static final String DOMAIN = "domain";
	private static final Map<String, Object> ONTOLOGY = Map.of("classDef", List.of(Map.of(
			"className", "item", "attrs", List.of(
					Map.of("name", "id", "type", "varchar", "primaryKey", true),
					Map.of("name", "name", "type", "varchar")))), "relationship_rule", Map.of());
	private static final String SORT_PATH = "steps[0].output.sort";
	private static final String INPUT = """
			{"answer":{"steps":[{
			  "graph":{"patterns":[{"objects":[{"idx":0,"class":"item","variable":"i"}]}]},
			  "output":{"fields":[{"variable":"i","field":"name","as":"name"}],"to_user":true}
			}]}}
			""";

	@Test
	void getNodeIdsReturnsTheDslRejectionThroughTheHttpErrorMapping() throws Exception {
		PostgreAdapter adapter = newAdapter();
		doThrow(new DslContractViolationException(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT,
				SORT_PATH, "PostgreAdapter: the requested sort is unsupported"))
				.when(adapter).executeDsl(anyString(), any(), any(), any());
		getNodeIds(adapter, JSONObject.parseObject(INPUT))
				.andExpect(status().isUnprocessableEntity())
				.andExpect(jsonPath("$.success").value(false))
				.andExpect(jsonPath("$.code").value(422))
				.andExpect(jsonPath("$.message", containsString("UNSUPPORTED_CONSTRUCT")))
				.andExpect(jsonPath("$.message", containsString(SORT_PATH)))
				.andExpect(jsonPath("$.message", containsString("PostgreAdapter")));
	}

	@Test
	void getNodeIdsRejectsMultipleObjectCalculationBeforeRewritingToIds() throws Exception {
		PostgreAdapter adapter = newAdapter();
		doThrow(new AssertionError("Invalid DSL reached the adapter"))
				.when(adapter).executeDsl(anyString(), any(), any(), any());
		JSONObject calculation = JSONObject.parseObject(INPUT);
		JSONObject step = calculation.getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
		step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects")
				.add(JSONObject.of("idx", 1, "class", "item", "variable", "j"));
		step.getJSONObject("output").getJSONArray("fields").getJSONObject(0).put("function", "count");
		getNodeIds(adapter, calculation)
				.andExpect(status().isUnprocessableEntity())
				.andExpect(jsonPath("$.message", containsString("INVALID_GRAMMAR")))
				.andExpect(jsonPath("$.message", containsString("steps[0].output.fields[0].function")));
	}

	@Test
	void getNodeIdsKeepsTheLegacyEmptyResultForOtherExecutionErrors() throws Exception {
		PostgreAdapter adapter = newAdapter();
		doThrow(new SQLException("Unavailable")).when(adapter).openConnection();
		getNodeIds(adapter, JSONObject.parseObject(INPUT))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$").isEmpty());
	}

	@Test
	void getNodeIdsKeepsTheRowRestrictionAndIdArray() throws Exception {
		PostgreAdapter adapter = newAdapter();
		Connection connection = mock(Connection.class);
		PreparedStatement statement = mock(PreparedStatement.class);
		ResultSet result = mock(ResultSet.class);
		ResultSetMetaData meta = mock(ResultSetMetaData.class);
		doReturn(connection).when(adapter).openConnection();
		when(connection.prepareStatement(anyString())).thenAnswer(call -> {
			assertTrue(call.<String>getArgument(0).contains("'permitted-id'"));
			return statement;
		});
		when(statement.executeQuery()).thenReturn(result);
		when(result.getMetaData()).thenReturn(meta);
		when(meta.getColumnCount()).thenReturn(1);
		when(meta.getColumnLabel(1)).thenReturn("i_id");
		when(result.next()).thenReturn(true, false);
		when(result.getObject(1)).thenReturn("permitted-id");
		getNodeIds(adapter, JSONObject.parseObject(INPUT))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$[0]").value("permitted-id"));
	}

	@ParameterizedTest
	@EnumSource(DslExecutionMode.class)
	void normalExecutionPreservesTheViolationWithAndWithoutRowPermission(DslExecutionMode mode) throws Exception {
		PostgreAdapter adapter = newAdapter();
		doThrow(new AssertionError("Rejected DSL reached JDBC")).when(adapter).openConnection();
		var results = HttpRequestUtil.executeDsl(new DataRagConfig(), adapter, JSONArray.of(orderedFirstStep()).toJSONString(),
				"s", false, ONTOLOGY, null, restrictedRows(), mode, DOMAIN);
		for (var result : results) {
			var error = assertInstanceOf(DslContractViolationException.class, result.failure().cause());
			var violation = error.getViolations().getFirst();
			assertEquals(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT, violation.getCode());
			assertEquals(SORT_PATH, violation.getDslPath());
			assertTrue(violation.getDetail().contains("PostgreAdapter"));
		}
	}

	@Test
	void multipleObjectsWithoutRelationshipsInTheFirstPatternAreRejectedBeforeJdbc() throws Exception {
		PostgreAdapter adapter = newAdapter();
		doThrow(new AssertionError("The unbound object reached JDBC")).when(adapter).openConnection();
		JSONObject dsl = orderedFirstStep();
		JSONObject first = dsl.getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
		first.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).getJSONArray("objects")
				.add(JSONObject.of("idx", 1, "class", "item", "variable", "other"));
		JSONObject output = first.getJSONObject("output");
		output.remove("sort");
		output.getJSONArray("fields").getJSONObject(0).put("variable", "other");

		var result = HttpRequestUtil.executeDsl(new DataRagConfig(), adapter, JSONArray.of(dsl).toJSONString(),
				"s", true, ONTOLOGY, null, restrictedRows(), DslExecutionMode.OPTIMIZED, DOMAIN)[1];

		var error = assertInstanceOf(DslContractViolationException.class, result.failure().cause());
		var violation = error.getViolations().getFirst();
		assertEquals(DslContractViolationException.Code.UNSUPPORTED_CONSTRUCT, violation.getCode());
		assertEquals("steps[0].graph.patterns[0].relationship", violation.getDslPath());
		assertTrue(violation.getDetail().contains("PostgreAdapter"));
		assertTrue(violation.getDetail().contains("query them separately"));
	}

	private static PostgreAdapter newAdapter() {
		return spy(new PostgreAdapter(new DataAdapterConnection(), ONTOLOGY));
	}

	private static JSONObject orderedFirstStep() {
		JSONObject dsl = JSONObject.parseObject(INPUT);
		JSONArray steps = dsl.getJSONObject("answer").getJSONArray("steps");
		JSONObject output = steps.getJSONObject(0).getJSONObject("output");
		output.put("to_user", false);
		output.put("save_table", "/item_details");
		output.put("sort", JSONObject.of("fields", JSONArray.of(
				JSONObject.of("variable", "i", "field", "name", "order", "asc"))));
		steps.add(JSONObject.of(
				"graph", JSONObject.of("patterns", JSONArray.of(JSONObject.of("objects",
						JSONArray.of(JSONObject.of("idx", 0, "class", "/item_details", "variable", "t"))))),
				"output", JSONObject.of("to_user", true, "fields", JSONArray.of(
						JSONObject.of("as", "name", "variable", "t", "field", "name")))));
		return dsl;
	}

	private static UserDataPermission restrictedRows() {
		var permission = new UserDataPermission();
		permission.addRowPermission("role", "item", LogicQuery.and(new PropertyQuery("id", "=", "permitted-id")));
		return permission;
	}

	private static ResultActions getNodeIds(PostgreAdapter adapter, JSONObject body) throws Exception {
		var user = mock(User.class);
		when(user.getDomainId()).thenReturn(DOMAIN);
		var identity = mock(IdentityService.class);
		when(identity.getCurrentUserDataPermission()).thenReturn(restrictedRows());
		var configs = mock(BusinessConfigService.class);
		var config = mock(BusinessConfig.class);
		when(configs.get(DOMAIN)).thenReturn(config);
		var admin = mock(AdminService.class);
		when(admin.getJSONRule(DOMAIN)).thenReturn(ONTOLOGY);
		var registry = mock(DataAdapterRegistry.class);
		when(registry.create(config, ONTOLOGY)).thenReturn(adapter);
		var service = new DslServiceImpl();
		ReflectionTestUtils.setField(service, "businessConfigService", configs);
		ReflectionTestUtils.setField(service, "adminService", admin);
		ReflectionTestUtils.setField(service, "dataAdapterRegistry", registry);
		var controller = new DslController();
		ReflectionTestUtils.setField(controller, "identityService", identity);
		ReflectionTestUtils.setField(controller, "dslService", service);
		var mvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new BaseControllerAdvice())
				.setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
		try (var system = mockStatic(SystemUtils.class)) {
			system.when(SystemUtils::getCurUser).thenReturn(user);
			return mvc.perform(post("/dsl/getNodeIds").contentType(MediaType.APPLICATION_JSON)
					.content(body.toJSONString()));
		}
	}
}

package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.MockedStatic;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.bean.OriginalQuestion;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.config.AgentConfig;
import io.ontomato.dataengine.config.AgentRole;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.config.ModelConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.dao.SubQueryWorkspaceDao;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.UserMessageUtil;

/** Model formatting must not decide whether a selected metric executes or a failure disappears. */
class MetricViewServiceImplInstantiationTest {

	private final MetricViewServiceImpl service = new MetricViewServiceImpl();
	private final MultiThreadAIChatService chat = mock(MultiThreadAIChatService.class);
	private final ABCProgramService executor = mock(ABCProgramService.class);
	private final SubQueryWorkspaceDao snapshots = mock(SubQueryWorkspaceDao.class);
	private final User user = mock(User.class);
	private MockedStatic<UserMessageUtil> messages;
	private JSONObject savedResult;

	@BeforeEach
	void setUp() throws Exception {
		MetricViewDao metrics = mock(MetricViewDao.class);
		FunctionDao functions = mock(FunctionDao.class);
		BusinessConfigService configs = mock(BusinessConfigService.class);
		AdminService admin = mock(AdminService.class);
		DataRagConfig config = new DataRagConfig();
		config.setCardBaseUrl("http://cards");
		ReflectionTestUtils.setField(service, "dataRagConfig", config);
		ReflectionTestUtils.setField(service, "metricViewDao", metrics);
		ReflectionTestUtils.setField(service, "functionDao", functions);
		ReflectionTestUtils.setField(service, "businessConfigService", configs);
		ReflectionTestUtils.setField(service, "adminService", admin);
		ReflectionTestUtils.setField(service, "langService", mock(LangService.class));
		ReflectionTestUtils.setField(service, "multiThreadAIChatService", chat);
		ReflectionTestUtils.setField(service, "abcProgramService", executor);
		ReflectionTestUtils.setField(service, "subQueryWorkspaceDao", snapshots);
		when(user.getId()).thenReturn("user");
		when(user.getDomainId()).thenReturn("domain");

		Function function = new Function();
		function.setId("function");
		function.setName("Orders");
		function.setCode("metric implementation");
		function.setParameters(List.of(parameter("scope", "sample"), parameter("optional", "sample")));
		ReturnDef returnDef = new ReturnDef();
		returnDef.setOutKeyRefs(List.of());
		function.setReturnDef(returnDef);
		MetricView metric = new MetricView();
		metric.setId("metric");
		metric.setName("Orders");
		metric.setMatchQuestions(new HashSet<>());
		when(metrics.find(anyString(), eq(MetricView.TYPE_GENERAL), isNull(), eq(10), eq(0.0), eq("domain")))
				.thenReturn(List.<Object[]>of(new Object[] {metric, "function"}));
		when(functions.queryList(isNull(), isNull(), eq("domain"))).thenReturn(List.of(function));
		BusinessConfig business = new BusinessConfig();
		ModelConfig model = new ModelConfig();
		model.setName("test");
		business.setModels(List.of(model));
		AgentConfig coding = new AgentConfig();
		coding.setModel("test");
		business.setAgents(Map.of(AgentRole.CODING, coding));
		when(configs.get("domain")).thenReturn(business);
		when(admin.getJSONRule("domain")).thenReturn(Map.of());
		messages = mockStatic(UserMessageUtil.class);
		messages.when(() -> UserMessageUtil.getReadFunctionInstancerUserMessage(
				anyString(), anyList(), any(), any(), anyString(), any(), anyMap(), anyString()))
				.thenReturn("Instantiate the supplied metric");
		when(snapshots.writeResult(any())).thenAnswer(invocation -> {
			savedResult = invocation.getArgument(0);
			return "snapshot";
		});
		when(executor.execute(anyString(), any(Function.class), eq("user"), any(), isNull(), eq("en"), anyInt(), eq("domain")))
				.thenAnswer(invocation -> {
					Function executed = invocation.getArgument(1);
					JSONObject row = new JSONObject();
					for (Parameter parameter : executed.getParameters()) {
						row.put(parameter.getName(), parameter.getValue());
					}
					return new Object[] {JSONArray.of(row), new PythonExecuteResult()};
				});
	}

	@AfterEach
	void closeMessages() {
		messages.close();
	}

	@ParameterizedTest
	@ValueSource(booleans = {false, true})
	void selectedMetricExecutesWithItsArgumentsInEitherOutputFormat(boolean fenced) throws Exception {
		String json = "[{\"id\":\"metric\",\"question\":\"Orders in requested scope\",\"parameters\":["
				+ "{\"name\":\"scope\",\"value\":\"requested\"},{\"name\":\"optional\",\"value\":\"\"}]}]";
		reply(fenced ? "```json\n" + json + "\n```" : json);

		assertEquals(1, run().size());
		JSONObject row = savedResult.getJSONArray("data").getJSONObject(0).getJSONArray("answer").getJSONObject(0);
		assertEquals("requested", row.getString("scope"));
		assertEquals("", row.getString("optional"));
	}

	@Test
	void anEmptySelectionRemainsALegitimateMiss() throws Exception {
		reply("[]");
		assertTrue(run().isEmpty());
	}

	@ParameterizedTest
	@ValueSource(strings = {"not json", "null", "{}", "[", "before\n```json\n[]\n```", "```json\n[]"})
	void malformedOutputIsNotReportedAsAnEmptySelection(String output) {
		reply(output);
		assertThrows(Exception.class, this::run);
	}

	@Test
	void anUnknownMetricIsNotReportedAsAnEmptySelection() {
		reply("[{\"id\":\"unknown\",\"parameters\":[]}]");
		assertThrows(IllegalArgumentException.class, this::run);
	}

	@Test
	void executionFailureReachesTheExistingErrorBoundary() throws Exception {
		reply("[{\"id\":\"metric\",\"question\":\"Orders\",\"parameters\":[]}]");
		Exception failure = new Exception("execution failed");
		when(executor.execute(anyString(), any(Function.class), anyString(), any(), isNull(), anyString(), anyInt(), anyString()))
				.thenThrow(failure);
		assertSame(failure, assertThrows(Exception.class, this::run));
	}

	private void reply(String output) {
		when(chat.chat(eq(MultiThreadAIChatService.READ_FUNCTION_INSTANCER), any(OriginalQuestion.class),
				eq("session"), anyString(), any(), eq("domain"))).thenReturn(output);
	}

	private List<?> run() throws Exception {
		return service.generateGeneralContent("session", "Orders", "en", user, new UserDataPermission(), 1, true);
	}

	private static Parameter parameter(String name, String value) {
		Parameter parameter = new Parameter();
		parameter.setName(name);
		parameter.setType(Parameter.TYPE_STRING);
		parameter.setValue(value);
		parameter.setClassNames(new ArrayList<>());
		return parameter;
	}
}

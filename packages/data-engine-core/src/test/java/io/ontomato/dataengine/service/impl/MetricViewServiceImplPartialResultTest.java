package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewContent;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

/** A MetricView card built from a partial execution says so in its text. */
class MetricViewServiceImplPartialResultTest {

	private final MetricViewServiceImpl service = new MetricViewServiceImpl();
	private final ABCProgramService abcProgramService = mock(ABCProgramService.class);
	private final User user = mock(User.class);

	@BeforeEach
	void setUp() {
		ReflectionTestUtils.setField(service, "abcProgramService", abcProgramService);
		when(user.getId()).thenReturn("user-1");
		when(user.getDomainId()).thenReturn("domain");
	}

	@Test
	void partialExecutionSaysSoOnTheCard() throws Exception {
		assertTrue(runCard(true).getMd().contains("partial hint"));
	}

	@Test
	void completeExecutionLeavesTheCardUnmarked() throws Exception {
		assertFalse(runCard(false).getMd().contains("partial hint"));
	}

	private MetricViewContent runCard(boolean partial) throws Exception {
		Function function = new Function();
		function.setName("Order total");
        function.setOperation(Function.OPERATION_READ);
		function.setParameters(new ArrayList<>());
		ReturnDef returnDef = new ReturnDef();
		returnDef.setOutKeyRefs(List.of());
		function.setReturnDef(returnDef);
		MetricView metricView = new MetricView();
		metricView.setName("Order total");
		metricView.setFunction(function);
		PythonExecuteResult execution = new PythonExecuteResult();
		if (partial) {
			execution.setPartialQuery(JSONObject.of("truncated", true, "rowLimit", 100000, "truncationHint", "partial hint"));
		}
		when(abcProgramService.execute(anyString(), any(Function.class), anyString(), any(), isNull(), anyString(), anyInt(), anyString()))
				.thenReturn(new Object[] {JSONArray.of(JSONObject.of("total", 5)), execution});
		return service.test(metricView, "en", user, new UserDataPermission(), 1);
	}
}

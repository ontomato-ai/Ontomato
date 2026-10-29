package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewContent;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.SubQueryWorkspaceDao;
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

/** A MetricView card built from a partial execution saves the flags on its snapshot answer and says so in its text. */
class MetricViewServiceImplPartialResultTest {

	private final MetricViewServiceImpl service = new MetricViewServiceImpl();
	private final ABCProgramService abcProgramService = mock(ABCProgramService.class);
	private final SubQueryWorkspaceDao snapshots = mock(SubQueryWorkspaceDao.class);
	private final User user = mock(User.class);

	@BeforeEach
	void setUp() {
		DataRagConfig config = new DataRagConfig();
		config.setCardBaseUrl("http://cards");
		ReflectionTestUtils.setField(service, "dataRagConfig", config);
		ReflectionTestUtils.setField(service, "abcProgramService", abcProgramService);
		ReflectionTestUtils.setField(service, "subQueryWorkspaceDao", snapshots);
		when(snapshots.writeResult(any())).thenReturn("short");
		when(user.getId()).thenReturn("user-1");
		when(user.getDomainId()).thenReturn("domain");
	}

	@Test
	void partialExecutionMarksTheSnapshotAnswerAndTheCardText() throws Exception {
		MetricViewContent content = runCard(true);

		JSONObject answer = savedAnswer();
		assertEquals(1, answer.getJSONArray("answer").size());
		assertEquals(Boolean.TRUE, answer.getBoolean("truncated"));
		assertEquals(100000, answer.getInteger("rowLimit"));
		assertEquals("partial hint", answer.getString("truncationHint"));
		assertTrue(content.getMd().contains("partial hint"), content.getMd());
	}

	@Test
	void completeExecutionLeavesTheSnapshotAnswerUnmarked() throws Exception {
		MetricViewContent content = runCard(false);

		JSONObject answer = savedAnswer();
		assertFalse(answer.containsKey("truncated"));
		assertFalse(answer.containsKey("rowLimit"));
		assertFalse(answer.containsKey("truncationHint"));
		assertFalse(content.getMd().contains("partial hint"), content.getMd());
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

	private JSONObject savedAnswer() {
		ArgumentCaptor<JSONObject> saved = ArgumentCaptor.forClass(JSONObject.class);
		verify(snapshots).writeResult(saved.capture());
		JSONArray data = saved.getValue().getJSONArray("data");
		assertEquals(1, data.size());
		return data.getJSONObject(0);
	}
}

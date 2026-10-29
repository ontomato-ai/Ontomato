package io.ontomato.dataengine.tools;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.JSONWriter.Feature;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;
import io.ontomato.dataengine.bean.DslExecutionResult;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.service.ai.AgentExecutionContext;
import io.ontomato.dataengine.logging.ServiceLogEvents;
import io.ontomato.dataengine.service.AgentWorkspaceService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.ai.MultiThreadAIChatService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DslUtil;
import io.ontomato.dataengine.dataAdapter.DslExecutionMode;
import io.ontomato.dataengine.util.HttpRequestUtil;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("dslSkillTools")
public class DslSkillTools {

	private static final ObjectReader DSL_FILE_READER = new ObjectMapper()
			.readerFor(new TypeReference<Map<String, Object>>() {})
			.with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
	
	@Autowired
    private DataRagConfig dataRagConfig;

	@Autowired
	private DataAdapterRegistry dataAdapterRegistry;
	
	@Autowired
    private BusinessConfigService businessConfigService;
	
	@Autowired
	private JSONRuleDao jsonRuleDao;
	
	@Autowired
	private VectorResourceDao vectorResourceDao;

	@Autowired
	private AgentWorkspaceService workspaceService;

	/** The only path-based DSL execution entry point in the whole repository, shared by all Agents; the execution status is recorded per file for submission validation. */
	@Tool("Execute the DSL JSON file in this workspace to get the query result or the raw error; the query result displays at most the first 100 records. "
			+ "Pass only the relative file name or path, for example query_0.json; the file content must be a single JSON object. "
			+ "Do not pass the full DSL text, the host directory, the user or the domain; a trial query does not replace the formal Python program test.")
	public String executeDslFile(@P("the relative path of the DSL JSON file in this workspace") String path) throws Exception {
		String sessionId = AgentExecutionContext.current().getSessionId();
		Path file = workspaceService.resolve(sessionId, path);
		workspaceService.clearExecution(sessionId, file.toString());
		if (!file.toString().endsWith(".json") || !Files.isRegularFile(file)) {
			throw new IllegalArgumentException("The execution entry point must be an existing JSON file in the workspace");
		}
		String content = Files.readString(file);
		Map<String, Object> dsl = DSL_FILE_READER.readValue(content);
		if (dsl == null) throw new IllegalArgumentException("The DSL file root must be a single JSON object");
		DslOutcome outcome = executeDslQuery(dsl);
		if (!content.equals(Files.readString(file))) throw new IllegalStateException("The DSL file changed during execution, please execute again");
		workspaceService.saveExecution(sessionId, file.toString(),
				new AgentWorkspaceService.FileExecution(content, outcome.ok() ? null : outcome.error(), null));
		return outcome.feedback();
	}

	record DslOutcome(boolean ok, String error, String feedback) {}

	/** The only implementation of DSL query execution, called by the path-based entry point. */
	protected DslOutcome executeDslQuery(Map<String, Object> dsl) {
		int maxRowSize = 100;
		String ret = null;
		String dslStr = null;
		String error = null;
		// ABC path m3.query event: sessionId takes the base sessionId of the outer AgentExecutionContext of the tool loop (no sub-query layer)
		AgentExecutionContext callContext = AgentExecutionContext.current();
		String sessionId = callContext == null ? null : callContext.getSessionId();
		boolean m3Started = false;
		try {
			JSONArray dsls = new JSONArray();
			dsls.add(dsl);
			dslStr = JSON.toJSONString(dsls, Feature.WriteMapNullValue);
			BusinessConfig businessConfig = businessConfigService.get(callContext.getDomainId());
			Map<String, Object> jsonRule = jsonRuleDao.query(callContext.getDomainId());
			dslStr = DslUtil.normalizeClassNames(dslStr, (List<Map<String, Object>>)jsonRule.get("classDef"));
			DataAdapter timeConditionAdapter = dataAdapterRegistry.create(businessConfig, jsonRule);
			dslStr = DslUtil.setConditionTimeColumnToCorrectFormat(dslStr, dataRagConfig.getDslMightTimeFormats(), (List<Map<String, Object>>)jsonRule.get("classDef"), timeConditionAdapter.timeConditionsAsEpochMillis(), timeConditionAdapter.timeConditionZone());
			ServiceLogEvents.lifecycle("m3.query.started", sessionId);
			m3Started = true;
			DslExecutionResult queryResult = HttpRequestUtil.executeDsl(dataRagConfig, timeConditionAdapter, dslStr, sessionId, false, jsonRule, vectorResourceDao, new UserDataPermission(), DslExecutionMode.OPTIMIZED, callContext.getDomainId())[0];
			JSONObject dataMap = queryResult.data();
			if (queryResult.failed()) {
				String rawError = MultiThreadAIChatService.rawErrorText(queryResult.failure().cause());
				error = rawError;
				ServiceLogEvents.lifecycle("m3.query.failed", sessionId);
				ServiceLogEvents.lifecycle("m3.query.finished", sessionId);
				ret = "Query execution error:\n" + rawError + "\nThe DSL actually executed this time:\n```json\n" + dslStr + "\n```";
			} else {
				ServiceLogEvents.lifecycle("m3.query.succeeded", sessionId);
				ServiceLogEvents.lifecycle("m3.query.finished", sessionId);
				m3Started = false;
				JSONArray data = dataMap.getJSONArray("data");
				JSONArray answer = new JSONArray();
				Boolean truncated = null;
				Integer rowLimit = null;
					String truncationHint = null;
				if (data != null && data.size() > 0) {
					JSONObject datum = data.getJSONObject(0);
					answer = datum.getJSONArray("answer");
					truncated = datum.getBoolean("truncated");
					rowLimit = datum.getInteger("rowLimit");
						truncationHint = datum.getString("truncationHint");
				}
				int total = answer.size();
				while (answer.size() > maxRowSize) {
					answer.remove(answer.size() - 1);
				}
				JSONObject obj = new JSONObject();
				JSONArray answers = new JSONArray();
				answers.add(answer);
				obj.put("data", answers);
				ret = "Query result:\n```json\n";
				ret += JSON.toJSONString(obj, JSONWriter.Feature.PrettyFormat, Feature.WriteMapNullValue) + "\n";
				ret += "```\n";
				if (Boolean.TRUE.equals(truncated)) {
						ret += "IMPORTANT: the result is INCOMPLETE"
								+ (rowLimit == null ? ". " : " (processing or output cap: " + rowLimit + " rows). ")
								+ (truncationHint == null ? "" : truncationHint + " ")
								+ "You may deliver these partial results with their limitation. Statistics, rankings and empty"
								+ " results apply only to the processed portion; do not treat this as an execution error or retry"
								+ " merely to remove the notice.";
				} else if (maxRowSize < total) {
					ret += "This DSL query actually returned a total of " + total + " records (executing this DSL request in the Python program returns according to the actual situation). Because the data volume is too large, the `query result` here only shows the first " + maxRowSize + " records.";
				}
			}
		} catch (Exception e) {
			String rawError = MultiThreadAIChatService.rawErrorText(e);
			error = rawError;
			log.error("[" + sessionId + "] DSL execution exception", e);
			ret = "Query execution error:\n" + rawError;
			if (m3Started) {
				// Only echo the DSL back after it was actually submitted for execution; a failure before submission has no "actually executed DSL"
				ret += "\nThe DSL actually executed this time:\n```json\n" + dslStr + "\n```";
				ServiceLogEvents.lifecycle("m3.query.failed", sessionId);
				ServiceLogEvents.lifecycle("m3.query.finished", sessionId);
			}
		}
		return new DslOutcome(error == null, error, ret);
	}

}

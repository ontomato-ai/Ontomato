package io.ontomato.dataengine.service;

import java.util.List;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

public interface ActionService {
	
	public Action generateFromNatureLanguage(String question, String lang, String domainId, boolean persistence) throws Exception;

	/** Short business-style examples for the action creation dialog. */
	public List<String> exampleRequests(String lang, String domainId) throws Exception;

	/** Generates an action with an optional structured intent produced by the creation wizard. */
	default Action generateFromNatureLanguage(
			String question, String lang, String domainId, boolean persistence, JSONObject structuredSpec) throws Exception {
		return generateFromNatureLanguage(question, lang, domainId, persistence);
	}

	public Action save(Action action, String lang) throws Exception;
	
	public void delete(String id, String lang) throws Exception;
	
	public Action queryById(String id);
	
	public List<Action> queryList(String status, String functionId, String className, String domainId);
	
	public List<Action> find(String question, String className, String domainId);

	public byte[] exportActions(String lang) throws Exception;

	public JSONObject reExplainActions(List<String> ids, boolean missingOnly, String lang) throws Exception;

	public JSONObject importActions(byte[] zipData, String lang, boolean allowMissingExplanation) throws Exception;
	
	public PythonExecuteResult execute(String id, JSONObject param, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception;
	
}

package io.ontomato.dataengine.service;

import java.util.List;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

public interface ActionService {
    /** A scheduler-owned run of the resolved Action returns the program's original result. */
    PythonExecuteResult executeScheduled(Action action, JSONObject parameters, String lang, User creator,
            UserDataPermission permission, int timeoutMinutes, java.util.UUID runId) throws Exception;

    PythonExecuteResult execute(String id, JSONObject param, String lang, User user, UserDataPermission permission, int timeoutMinutes, ExecutionTarget target) throws Exception;

	
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

	/**
	 * An Action's form: its fields and their text, from the values the page binds by parameter name. With the fields'
	 * {@code submitted} text it also answers the field errors, or the typed parameters {@link #execute} takes; the
	 * {@code readOnly} parameters keep their bound values.
	 */
	public JSONObject form(String id, JSONObject bound, JSONObject submitted, List<String> readOnly, String lang, User user) throws Exception;
	
}

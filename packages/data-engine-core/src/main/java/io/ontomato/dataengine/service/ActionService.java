package io.ontomato.dataengine.service;

import io.ontomato.dataengine.service.agent.OntologyAgentStore.Owner;
import java.util.List;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.action.BusinessMeaning;
import io.ontomato.dataengine.bean.function.Parameter;
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

	/**
	 * Saves an Action. With an explanation reference, the explanation accepted for exactly this code is reused and an
	 * invalid reference is refused; without one, the explanation is reused or produced as before.
	 */
	public Action save(Action action, String explanationRef, Owner owner, String lang) throws Exception;

	/** An unsaved draft's explanation, and the reference a later save of exactly this code reuses it by. */
	record ExplainedDraft(JSONArray codeSegments, BusinessMeaning businessMeaning, String explanationRef) {}

	/**
	 * Explains code that is not saved, as the given owner, through the same explanation core a save uses; nothing is
	 * saved. The accepted result is recorded on the explanation run with the code's digest and the explanation version,
	 * so a later save of the same code reuses it by reference instead of explaining again.
	 */
	public ExplainedDraft explainDraft(String code, List<Parameter> parameters, Owner owner, String lang);
	
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

	/** The owner's form description for an Action, or a field error for an incoming draft. */
	public JSONObject definitionForm(JSONObject request, String lang, String domainId);

	/** One item of a batch publication-status change: its saved action, or why it failed. */
	record StatusResult(String id, Action data, String error) {}

	/** Change only the status of each action, saving it as the acting owner. */
	public List<StatusResult> setStatus(String domainId, String userId, List<String> ids, String status, String lang);
	
}

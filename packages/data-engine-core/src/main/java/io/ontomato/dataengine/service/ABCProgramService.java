package io.ontomato.dataengine.service;

import java.io.File;
import java.util.List;

import com.alibaba.fastjson2.JSONArray;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessDashboard;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

public interface ABCProgramService {

	/** Returns {rows, PythonExecuteResult}, like the read-function variant; the result carries the run's partial-query status. */
	public Object[] execute(String sessionId, ABCHarnessProgram program, String userId, UserDataPermission curUserDataPermission, String lang, int timeoutMinutes, String domainId) throws Exception;
	
	/** Returns {rows, PythonExecuteResult}, like the read-function variant; the result carries the run's partial-query status. */
	public Object[] execute(String sessionId, ABCHarnessDashboard dashboard, String userId, UserDataPermission curUserDataPermission, String lang, int timeoutMinutes, String domainId) throws Exception;
	
	public Object[] execute(String sessionId, Function function, String userId, UserDataPermission curUserDataPermission, String sandboxId, String lang, int timeoutMinutes, String domainId) throws Exception;

	/**
	 * Runs a stored program with an identity snapshot the caller established.
	 *
	 * <p>Passed on this call rather than looked up here because only the caller knows facts the environment
	 * cannot derive — an action execution knows which workflow run its preconditions just proved. The
	 * snapshot still reaches the program as a server-written read-only file, never as a parameter.</p>
	 *
	 * @param identity extra snapshot fields to publish, or null to publish the subject's own identity only
	 */
	public Object[] execute(String sessionId, Function function, String userId, UserDataPermission curUserDataPermission, String sandboxId, String lang, int timeoutMinutes, String domainId, com.alibaba.fastjson2.JSONObject identity) throws Exception;
	
	public JSONArray parsePythonReturn(String pythonOutput, String errorMessage) throws Exception;

	public JSONArray dealPythonReturn(String pythonOutput, String errorMessage, List<ABCHarnessProgramOutKeyRef> outKeyRefs, UserDataPermission curUserDataPermission) throws Exception;
	
	
}

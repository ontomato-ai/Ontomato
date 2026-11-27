package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.DataService;
import io.ontomato.dataengine.service.ExecutionTarget;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.agent.AgentExecutionScope;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SystemUtils;
import jakarta.servlet.http.HttpServletRequest;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
@Owned
public class DataController {
    private final AgentExecutionScope agentExecutionScope;

    public DataController(AgentExecutionScope agentExecutionScope) {
        this.agentExecutionScope = agentExecutionScope;
    }

	
	@Autowired
    private IdentityService identityService;
	
	@Autowired
    private DataService dataService;
	
	@GetMapping("/data/instanceGraph/summary")
	public JSONObject instanceGraphSummary(HttpServletRequest request) {
		return instanceGraph("summary", new JSONObject(), request);
	}

	@GetMapping("/data/instanceGraph/statistics")
	public JSONObject instanceGraphStatistics(HttpServletRequest request) {
		return instanceGraph("statistics", new JSONObject(), request);
	}

	@GetMapping("/data/instanceGraph/nodes")
	public JSONObject instanceGraphNodes(HttpServletRequest request) {
		return instanceGraph("nodes", new JSONObject(), request);
	}

	@PostMapping("/data/instanceGraph/connections")
	public JSONObject instanceGraphConnections(@RequestBody JSONObject param, HttpServletRequest request) {
		return instanceGraph("connections", param, request);
	}

	@PostMapping("/data/instanceGraph/search")
	public JSONObject instanceGraphSearch(@RequestBody JSONObject param, HttpServletRequest request) {
		return instanceGraph("search", param, request);
	}

	@PostMapping("/data/instanceGraph/neighborhood")
	public JSONObject instanceGraphNeighborhood(@RequestBody JSONObject param, HttpServletRequest request) {
		return instanceGraph("neighborhood", param, request);
	}
	
	private JSONObject instanceGraph(String operation, JSONObject parameters, HttpServletRequest request) {
		var user = SystemUtils.getCurUser();
		var permission = identityService.getCurrentUserDataPermission();
		return dataService.queryInstanceGraph(operation, parameters, permission, user.getDomainId(),
				executionTarget(request, user, permission));
	}

	@PostMapping("/data/queryInfoByNode")
    @ResponseBody
    public JSONObject queryInfoByNode(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param, HttpServletRequest executionRequest) {
		UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
		User user = SystemUtils.getCurUser();
		requireClassScope(executionRequest, user, curUserDataPermission, param == null ? null : param.getString("class"));
		return dataService.queryInfoByNode(param, lang, curUserDataPermission, user.getDomainId());
	}

	/**Perform a full-text search on all classes
	 * @param param
	 * @return
	 */
	@PostMapping("/data/fulltextsearch")
	@ResponseBody
	public JSONObject fullTextSearch(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param, HttpServletRequest executionRequest) {
		UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
		User user = SystemUtils.getCurUser();
		// Whole-domain search cannot run under a class-scoped agent turn.
		executionTarget(executionRequest, user, curUserDataPermission).requireClasses(List.of());
		JSONObject searchResult = dataService.fullTextSearch(param, lang, curUserDataPermission, user.getDomainId());
		return searchResult;
	}

	@GetMapping("/data/getclassandcount")
	@ResponseBody
	public JSONObject getClassAndCount(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, HttpServletRequest executionRequest) {
		UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
		User user = SystemUtils.getCurUser();
		// Whole-domain class counts cannot run under a class-scoped agent turn.
		executionTarget(executionRequest, user, curUserDataPermission).requireClasses(List.of());
		JSONObject searchResult = dataService.getClassAndCount(lang, curUserDataPermission, user.getDomainId());
		return searchResult;
	}

	@PostMapping("/data/getclassdatabypage")
	@ResponseBody
	public JSONObject getClassDataByPage(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param, HttpServletRequest executionRequest) {
		UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
		User user = SystemUtils.getCurUser();
		requireClassScope(executionRequest, user, curUserDataPermission, param == null ? null : param.getString("classname"));
		JSONObject searchResult = dataService.getClassDataByPage(param, lang, curUserDataPermission, user.getDomainId());
		return searchResult;
	}
	
	@PostMapping("/data/getWholeClassDataByPage")
	@ResponseBody
	public JSONObject getWholeClassDataByPage(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param, HttpServletRequest executionRequest) {
		UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
		User user = SystemUtils.getCurUser();
		requireClassScope(executionRequest, user, curUserDataPermission, param == null ? null : param.getString("classname"));
		JSONObject searchResult = dataService.getWholeClassDataByPage(param, lang, curUserDataPermission, user.getDomainId());
		return searchResult;
	}
	
	@PostMapping("/data/queryDistinctAttrValue")
	@ResponseBody
	public JSONObject queryDistinctAttrValue(@RequestBody JSONObject param, HttpServletRequest executionRequest) {
		UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
		User user = SystemUtils.getCurUser();
		// Enforce caller class scope before the try block so 403 refusals propagate as HTTP errors.
		requireClassScope(executionRequest, user, curUserDataPermission, param == null ? null : param.getString("className"));
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className");
			String attrName = param.getString("attrName");
			String query = param.getString("query");
			List<String> values = dataService.queryDistinctAttrValue(className, attrName, query, curUserDataPermission, user.getDomainId());
			ret.put("data", values);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	private ExecutionTarget executionTarget(HttpServletRequest executionRequest, User user, UserDataPermission permission) {
		return agentExecutionScope.target(executionRequest, user, permission, ExecutionTarget.LIVE);
	}

	private void requireClassScope(HttpServletRequest executionRequest, User user, UserDataPermission permission, String className) {
		ExecutionTarget target = executionTarget(executionRequest, user, permission);
		if (!target.testing() && target.classNames().isEmpty()) {
			return;
		}
		target.requireClasses(className == null || className.isBlank() ? List.of() : List.of(className));
	}

}

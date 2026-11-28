package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dataAdapter.DslContractViolationException;
import io.ontomato.dataengine.service.DslService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SystemUtils;

@RestController
@Owned
public class DslController {
	
	@Autowired
    private IdentityService identityService;
	
	@Autowired
	private DslService dslService;

	@PostMapping("/dsl/executeV0")
    @ResponseBody
    public Map<String, Object> executeV0(@RequestBody JSONObject dsl) {
		User user = SystemUtils.getCurUser();
		UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
    	return dslService.executeV0(dsl, curUserDataPermission, user);
    }
	
	@PostMapping("/dsl/executeV1")
    @ResponseBody
    public Map<String, Object> executeV1(@RequestBody JSONObject dsl) {
		User user = SystemUtils.getCurUser();
		UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
    	return dslService.executeV1(dsl, curUserDataPermission, user);
    }
	
	@PostMapping("/dsl/getNodeIds")
    @ResponseBody
    public List<String> getNodeIds(@RequestBody JSONObject dsl) {
		User user = SystemUtils.getCurUser();
		UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
		try {
			return dslService.getNodeIds(dsl, curUserDataPermission, user);
		} catch (DslContractViolationException e) {
			String reason = e.getViolations().stream().map(DslContractViolationException.Violation::toString)
					.collect(Collectors.joining("; "));
			throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, reason, e);
		}
    }
	
}

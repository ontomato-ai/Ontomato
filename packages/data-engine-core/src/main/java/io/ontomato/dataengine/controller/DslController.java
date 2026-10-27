package io.ontomato.dataengine.controller;

import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.DslService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SystemUtils;

@RestController
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
    	List<String> nodeIds = dslService.getNodeIds(dsl, curUserDataPermission, user);
    	return nodeIds;
    }
	
}

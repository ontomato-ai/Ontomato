package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.authorization.ManagementEndpoint;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.service.authorization.ManagementOperations;

import java.io.InputStream;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.EnvService;
import io.ontomato.dataengine.util.SystemUtils;

@RestController
public class TestEnvController {

    @Component
    static final class Operations implements ManagementOperations.Contributor {
        static final String READ = "test-environment.read";
        static final String CHANGE = "test-environment.change";
        @Override
        public java.util.List<ManagementOperations.Operation> managementOperations() {
            return java.util.List.of(
                    new ManagementOperations.Operation(READ, "Read test environment status", ManagementOperations.Access.READ),
                    new ManagementOperations.Operation(CHANGE, "Import test environment definitions and data", ManagementOperations.Access.CHANGE));
        }
    }

	
	@Autowired
	private EnvService envService;

	@ManagementEndpoint(Operations.CHANGE)
	@GetMapping("/testEnv/importSchema")
    @ResponseBody
    public JSONObject importSchema() {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			envService.importSchema(user);
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@ManagementEndpoint(Operations.READ)
	@GetMapping("/testEnv/mode")
	@ResponseBody
	public JSONObject mode() {
		JSONObject ret = new JSONObject();
		try {
			ret.put("success", true);
			ret.put("data", envService.isProductionEnvConfigured() ? "two-env" : "single-env");
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@ManagementEndpoint(Operations.CHANGE)
	@PostMapping("/testEnv/importData")
    @ResponseBody
    public JSONObject importTestData(@RequestParam(value = "file") MultipartFile file) {
		JSONObject ret = new JSONObject();
		InputStream is = null;
		try {
			User user = SystemUtils.getCurUser();
			is = file.getInputStream();
			envService.importTestData(is, user.getDomainId());
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		} finally {
			if (is != null) {
				try {
					is.close();
				} catch (Exception e) {}
			}
		}
		return ret;
	}
	
}

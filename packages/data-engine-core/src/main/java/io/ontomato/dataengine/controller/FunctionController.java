package io.ontomato.dataengine.controller;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.FunctionService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.util.SystemUtils;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
public class FunctionController {
	
	@Autowired
	private FunctionService functionService;

	@Autowired
	private LangService langService;

	@Autowired
	private ObjectMapper objectMapper;

	@PostMapping("/function/save")
    @ResponseBody
    public JSONObject save(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			Function function = Function.fromInput(param);
			function.setDomainId(user.getDomainId());
			ret.put("data", withDisplay(functionService.save(function, lang), lang));
			ret.put("success", true);
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/function/delete")
    @ResponseBody
    public JSONObject delete(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String id = param.getString("id");
			functionService.delete(id, lang);
			ret.put("success", true);
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
	@PostMapping("/function/queryById")
    @ResponseBody
    public JSONObject queryById(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String id = param.getString("id");
			Function function = functionService.queryById(id);
			ret.put("success", true);
			ret.put("data", function == null ? null : withDisplay(function, lang));
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
	@PostMapping("/function/form")
    @ResponseBody
    public JSONObject form(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			ret.put("data", functionService.form(param, lang, user.getDomainId()));
			ret.put("success", true);
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
	@PostMapping("/function/queryList")
    @ResponseBody
    public JSONObject queryList(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, defaultValue = "en") String lang,
		@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String operation = param.getString("operation");
			String className = param.getString("className");
			List<Function> functions = functionService.queryList(operation, className, user.getDomainId());
			ret.put("success", true);
			ret.put("data", withDisplay(functions, lang));
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	private ObjectNode withDisplay(Function function, String lang) {
		ObjectNode item = objectMapper.valueToTree(function);
		item.put("operationLabel", operationLabel(function.getOperation(), lang));
		return item;
	}

	private ArrayNode withDisplay(List<Function> functions, String lang) {
		ArrayNode items = objectMapper.createArrayNode();
		for (Function function : functions) items.add(withDisplay(function, lang));
		return items;
	}

	private String operationLabel(String operation, String lang) {
		if (operation == null) return null;
		return switch (operation) {
			case Function.OPERATION_READ -> langService.get(lang, "PanelForm.operation.read");
			case Function.OPERATION_WRITE -> langService.get(lang, "PanelForm.operation.write");
			case Function.OPERATION_PRODUCT -> langService.get(lang, "PanelForm.operation.product");
			default -> operation;
		};
	}
	
}

package io.ontomato.dataengine.controller;

import java.io.InputStream;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.config.ServiceConst;
import io.ontomato.dataengine.service.WriteFunctionOperationService;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
public class WriteFunctionOperationController {

    @Autowired private jakarta.servlet.http.HttpServletRequest request;
    @Autowired private io.ontomato.dataengine.service.QueryAccessService accessService;
    @Autowired private io.ontomato.dataengine.service.OntologyQueryService queries;

    @Autowired private io.ontomato.dataengine.dao.JSONRuleDao jsonRuleDao;

    @SuppressWarnings("unchecked")
    private JSONObject validatedWhere(Object raw, String className, String domainId) {
        io.ontomato.dataengine.util.WriteWhereValidator.validateStructure(raw);
        var classes = (java.util.List<Map<String, Object>>) jsonRuleDao.query(domainId).get("classDef");
        var classDef = classes.stream().filter(c -> className.equals(c.get("className"))).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unknown class: " + className));
        var attrs = (java.util.List<Map<String, Object>>) classDef.get("attrs");
        var fields = attrs.stream().filter(a -> !Boolean.FALSE.equals(a.get("enable")))
                .map(a -> (String) a.get("name")).collect(java.util.stream.Collectors.toSet());
        return io.ontomato.dataengine.util.WriteWhereValidator.validate(raw, fields::contains);
    }

    private void checkClasses(String... names) {
        java.util.List<String> scope = grant().getList("classNames", String.class);
        if (scope != null && !scope.isEmpty()) for (String name : names)
            if (!scope.contains(name)) throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN, "Class is outside this operation");
    }
	
	@Autowired
	private WriteFunctionOperationService writeFunctionOperationService;

	@PostMapping("/writeFunctionOperation/insert")
    @ResponseBody
    public JSONObject insert(@RequestBody JSONObject param) throws Exception {
		JSONObject ret = new JSONObject();
		try {
			String className = requiredText(param, "className");
            checkClasses(className);
			String sandboxId = dealSandboxId(grant().getString("sandboxId"));
			String domainId = grant().getString("domainId");
			if (!(param.get("objs") instanceof JSONArray)) throw new IllegalArgumentException("objs: expected a nonempty array of object dictionaries");
            JSONArray objs = param.getJSONArray("objs");
			writeFunctionOperationService.insert(className, objs, sandboxId, domainId);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
    }
	
	@PostMapping("/writeFunctionOperation/update")
    @ResponseBody
    public JSONObject update(@RequestBody JSONObject param) throws Exception {
		JSONObject ret = new JSONObject();
		try {
			String className = requiredText(param, "className");
            checkClasses(className);
			String sandboxId = dealSandboxId(grant().getString("sandboxId"));
			String domainId = grant().getString("domainId");
			if (!(param.get("setValues") instanceof JSONObject values) || values.isEmpty())
                throw new IllegalArgumentException("setValues: expected a nonempty object of attribute values; use updateVector for vector attributes");
            JSONObject setValues = values;
			JSONObject where = validatedWhere(param.get("where"), className, domainId);
			writeFunctionOperationService.update(className, setValues, where, sandboxId, domainId);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
    }
	
	@PostMapping("/writeFunctionOperation/delete")
    @ResponseBody
    public JSONObject delete(@RequestBody JSONObject param) throws Exception {
		JSONObject ret = new JSONObject();
		try {
			String className = requiredText(param, "className");
            checkClasses(className);
			String sandboxId = dealSandboxId(grant().getString("sandboxId"));
			String domainId = grant().getString("domainId");
			JSONObject where = validatedWhere(param.get("where"), className, domainId);
			writeFunctionOperationService.delete(className, where, sandboxId, domainId);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
    }
	
	@PostMapping("/writeFunctionOperation/createEdge")
    @ResponseBody
    public JSONObject createEdge(@RequestBody JSONObject param) throws Exception {
		JSONObject ret = new JSONObject();
		try {
			String relationName = requiredText(param, "relationName");
			String sourceClassName = requiredText(param, "sourceClassName");
			String sourceObjId = requiredText(param, "sourceObjId");
			String targetClassName = requiredText(param, "targetClassName");
			String targetObjId = requiredText(param, "targetObjId");
			String sandboxId = dealSandboxId(grant().getString("sandboxId"));
			String domainId = grant().getString("domainId");
			checkClasses(sourceClassName, targetClassName);
            writeFunctionOperationService.createEdge(relationName, sourceClassName, sourceObjId, targetClassName, targetObjId, sandboxId, domainId);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
    }
	
	@PostMapping("/writeFunctionOperation/deleteEdge")
    @ResponseBody
    public JSONObject deleteEdge(@RequestBody JSONObject param) throws Exception {
		JSONObject ret = new JSONObject();
		try {
			String relationName = requiredText(param, "relationName");
			String sourceClassName = requiredText(param, "sourceClassName");
			String sourceObjId = requiredText(param, "sourceObjId");
			String targetClassName = requiredText(param, "targetClassName");
			String targetObjId = requiredText(param, "targetObjId");
			String sandboxId = dealSandboxId(grant().getString("sandboxId"));
			String domainId = grant().getString("domainId");
			checkClasses(sourceClassName, targetClassName);
            writeFunctionOperationService.deleteEdge(relationName, sourceClassName, sourceObjId, targetClassName, targetObjId, sandboxId, domainId);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
    }
	
	@PostMapping("/writeFunctionOperation/query")
    @ResponseBody
    public Map<String, Object> query(@RequestBody JSONObject param) throws Exception {
		JSONObject dsl = validDslJsonFormat(param);
        grant();
        return queries.execute(dsl, accessService.access(request));
    }
	

    @PostMapping("/writeFunctionOperation/appendVector")
    public JSONObject appendVector(@RequestBody JSONObject body) throws Exception {
        byte[] bytes=vectorBytes(body);
        try(var input=new java.io.ByteArrayInputStream(bytes)) {
            checkClasses(requiredText(body, "className"));
            writeFunctionOperationService.appendVector(requiredText(body, "className"),requiredText(body, "attrName"),requiredText(body, "objectId"),body.getString("text"),input,getSuffix(body.getString("fileName")),dealSandboxId(grant().getString("sandboxId")),grant().getString("domainId"));
        }
        return JSONObject.of("success",true);
    }
    @PostMapping("/writeFunctionOperation/updateVector")
    public JSONObject updateVector(@RequestBody JSONObject body) throws Exception {
        byte[] bytes=vectorBytes(body);
        try(var input=new java.io.ByteArrayInputStream(bytes)) {
            checkClasses(requiredText(body, "className"));
            writeFunctionOperationService.updateVector(requiredText(body, "className"),requiredText(body, "attrName"),requiredText(body, "objectId"),requiredText(body, "fileId"),body.getString("text"),input,dealSandboxId(grant().getString("sandboxId")),grant().getString("domainId"));
        }
        return JSONObject.of("success",true);
    }
    private static String requiredText(JSONObject body, String field) {
        if (!(body.get(field) instanceof String value) || value.isBlank())
            throw new IllegalArgumentException(field + ": expected a nonempty string; supply this field as text");
        return value;
    }

    private static byte[] vectorBytes(JSONObject body) {
        String text = requiredText(body, "text");
        if (body.get("fileBase64") == null) return text.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        String encoded = requiredText(body, "fileBase64");
        try { return java.util.Base64.getDecoder().decode(encoded); }
        catch (IllegalArgumentException invalid) {
            throw new IllegalArgumentException("fileBase64: expected base64 file content; encode the file bytes as base64", invalid);
        }
    }

    private JSONObject grant() {
        var request=((org.springframework.web.context.request.ServletRequestAttributes)org.springframework.web.context.request.RequestContextHolder.currentRequestAttributes()).getRequest();
        return (JSONObject)request.getAttribute(io.ontomato.dataengine.service.QueryGrantService.ATTRIBUTE);
    }

	@PostMapping("/writeFunctionOperation/deleteVector")
    @ResponseBody
    public JSONObject deleteVector(@RequestBody JSONObject param) throws Exception {
		JSONObject ret = new JSONObject();
		try {
			String className = requiredText(param, "className");
            checkClasses(className);
			String attrName = requiredText(param, "attrName");
			String objectId = requiredText(param, "objectId");
			String fileId = requiredText(param, "fileId");
			String sandboxId = dealSandboxId(grant().getString("sandboxId"));
			String domainId = grant().getString("domainId");
			writeFunctionOperationService.deleteVector(className, attrName, objectId, fileId, sandboxId, domainId);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
    }
	
	private String getSuffix(String filename) {
		if (filename == null) {
			return "";
		}
		int idx = filename.lastIndexOf(".");
		if (idx >= 0 && idx < filename.length() - 1) {
			return filename.substring(idx + 1);
		}
		return "";
	}
	
	private JSONObject validDslJsonFormat(JSONObject param) {
        if (!(param.get("dsl") instanceof JSONObject dsl) || dsl.isEmpty())
            throw new IllegalArgumentException("dsl: expected one nonempty JSON object; send {\"dsl\":{...}}, not an array or JSON string");
        return dsl;
    }	
	private String dealSandboxId(String sandboxId) {
		if (ServiceConst.NOT_SANDBOX.equals(sandboxId)) {
			return null;
		} else {
			return sandboxId;
		}
	}
	
}

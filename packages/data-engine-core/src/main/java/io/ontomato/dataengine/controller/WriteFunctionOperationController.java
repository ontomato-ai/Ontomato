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
	
	@Autowired
	private WriteFunctionOperationService writeFunctionOperationService;

	@PostMapping("/writeFunctionOperation/insert")
    @ResponseBody
    public JSONObject insert(@RequestBody JSONObject param) throws Exception {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className");
			String sandboxId = dealSandboxId(grant().getString("sandboxId"));
			String domainId = grant().getString("domainId");
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
			String className = param.getString("className");
			String sandboxId = dealSandboxId(grant().getString("sandboxId"));
			String domainId = grant().getString("domainId");
			JSONObject setValues = param.getJSONObject("setValues");
			JSONObject where = param.getJSONObject("where");
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
			String className = param.getString("className");
			String sandboxId = dealSandboxId(grant().getString("sandboxId"));
			String domainId = grant().getString("domainId");
			JSONObject where = param.getJSONObject("where");
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
			String relationName = param.getString("relationName");
			String sourceClassName = param.getString("sourceClassName");
			String sourceObjId = param.getString("sourceObjId");
			String targetClassName = param.getString("targetClassName");
			String targetObjId = param.getString("targetObjId");
			String sandboxId = dealSandboxId(grant().getString("sandboxId"));
			String domainId = grant().getString("domainId");
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
			String relationName = param.getString("relationName");
			String sourceClassName = param.getString("sourceClassName");
			String sourceObjId = param.getString("sourceObjId");
			String targetClassName = param.getString("targetClassName");
			String targetObjId = param.getString("targetObjId");
			String sandboxId = dealSandboxId(grant().getString("sandboxId"));
			String domainId = grant().getString("domainId");
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
		String sandboxId = dealSandboxId(grant().getString("sandboxId"));
		String domainId = grant().getString("domainId");
		return writeFunctionOperationService.query(dsl, sandboxId, domainId);
    }
	

    @PostMapping("/writeFunctionOperation/appendVector")
    public JSONObject appendVector(@RequestBody JSONObject body) throws Exception {
        byte[] bytes=body.getString("fileBase64")==null?java.util.Objects.toString(body.getString("text"),"").getBytes(java.nio.charset.StandardCharsets.UTF_8):java.util.Base64.getDecoder().decode(body.getString("fileBase64"));
        try(var input=new java.io.ByteArrayInputStream(bytes)) {
            writeFunctionOperationService.appendVector(body.getString("className"),body.getString("attrName"),body.getString("objectId"),body.getString("text"),input,getSuffix(body.getString("fileName")),dealSandboxId(grant().getString("sandboxId")),grant().getString("domainId"));
        }
        return JSONObject.of("success",true);
    }
    @PostMapping("/writeFunctionOperation/updateVector")
    public JSONObject updateVector(@RequestBody JSONObject body) throws Exception {
        byte[] bytes=body.getString("fileBase64")==null?java.util.Objects.toString(body.getString("text"),"").getBytes(java.nio.charset.StandardCharsets.UTF_8):java.util.Base64.getDecoder().decode(body.getString("fileBase64"));
        try(var input=new java.io.ByteArrayInputStream(bytes)) {
            writeFunctionOperationService.updateVector(body.getString("className"),body.getString("attrName"),body.getString("objectId"),body.getString("fileId"),body.getString("text"),input,dealSandboxId(grant().getString("sandboxId")),grant().getString("domainId"));
        }
        return JSONObject.of("success",true);
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
			String className = param.getString("className");
			String attrName = param.getString("attrName");
			String objectId = param.getString("objectId");
			String fileId = param.getString("fileId");
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
	
	private JSONObject validDslJsonFormat(JSONObject param) throws Exception {
		try {
			JSONObject dsl = param.getJSONObject("dsl");
			if (dsl == null) {
				throw new Exception();
			}
			return dsl;
		} catch (Exception e) {
			try {
				JSONArray dsls = param.getJSONArray("dsl");
				return dsls.getJSONObject(0);
			} catch (Exception e1) {
				throw new Exception(e1.getMessage());
			}
		}
	}
	
	private String dealSandboxId(String sandboxId) {
		if (ServiceConst.NOT_SANDBOX.equals(sandboxId)) {
			return null;
		} else {
			return sandboxId;
		}
	}
	
}

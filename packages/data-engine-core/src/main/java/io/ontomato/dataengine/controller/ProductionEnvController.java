package io.ontomato.dataengine.controller;

import java.util.ArrayList;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.EnvService;

@RestController
public class ProductionEnvController {
	
	@Autowired
	private EnvService envService;

	@PostMapping("/productionEnv/queryData")
    @ResponseBody
    public JSONObject queryData(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			JSONObject dsl = validDslJsonFormat(param);
			ret = envService.executeDslInProductionEnv(dsl);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	private JSONObject validDslJsonFormat(JSONObject param) {
        if (!(param.get("dsl") instanceof JSONObject dsl) || dsl.isEmpty())
            throw new IllegalArgumentException("dsl: expected one nonempty JSON object; send {\"dsl\":{...}}, not an array or JSON string");
        return dsl;
    }	
	@PostMapping("/productionEnv/queryDistinctAttrValue")
    @ResponseBody
    public JSONObject queryDistinctAttrValue(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className");
			String attrName = param.getString("attrName");
			String like = param.getString("like");
			Integer limit = param.getInteger("limit");
			ret.put("success", true);
			ret.put("data", envService.queryDistinctAttrValueInProductionEnv(className, attrName, like, limit == null ? 0 : limit));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
		
	}
	
	@PostMapping("/productionEnv/sync")
	@ResponseBody
	public JSONObject sync(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			List<String> actionIds = new ArrayList<String>();
			JSONArray actionArray = param.getJSONArray("actionIds");
			if (actionArray != null) {
				for (int i = 0; i < actionArray.size(); i++) {
					actionIds.add(actionArray.getString(i));
				}
			}
			List<String> metricViewIds = new ArrayList<String>();
			JSONArray metricViewArray = param.getJSONArray("metricViewIds");
			if (metricViewArray != null) {
				for (int i = 0; i < metricViewArray.size(); i++) {
					metricViewIds.add(metricViewArray.getString(i));
				}
			}
			if (param.containsKey("dryRun") && !(param.get("dryRun") instanceof Boolean))
                throw new IllegalArgumentException("dryRun: expected a boolean; omit it for a dry run or send false explicitly to write");
            ret = envService.syncAssetsToProduction(actionIds, metricViewIds, !Boolean.FALSE.equals(param.get("dryRun")));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/productionEnv/queryBusinessKnowledge")
    @ResponseBody
    public JSONObject queryBusinessKnowledge(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String question = param.getString("question");
			Integer max_result = param.getInteger("max_result");
			String md = envService.queryBusinessKnowledgeInProductionEnv(question, max_result);
			ret.put("success", true);
			ret.put("data", md);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
}

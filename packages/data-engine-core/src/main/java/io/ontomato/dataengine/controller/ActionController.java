package io.ontomato.dataengine.controller;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.ActionService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SystemUtils;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
public class ActionController {

	@Autowired
    private IdentityService identityService;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private ActionService actionService;

	@Autowired
	private LangService langService;
	
	@PostMapping("/action/generateFromNatureLanguage")
    @ResponseBody
    public JSONObject generateFromNatureLanguage(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
	    	User user = SystemUtils.getCurUser();
			String question = param.getString("question");
			Boolean persistence = param.getBoolean("persistence");
			if (persistence == null) {
				persistence = false;
			}
			JSONObject structuredSpec = param.getJSONObject("structuredSpec");
			Action action = actionService.generateFromNatureLanguage(question, lang, user.getDomainId(), persistence, structuredSpec);
			if (action == null) {
				throw new Exception(langService.get(lang, "Action.notGenerated"));
			}
			ret.put("success", true);
			ret.put("data", action);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/action/exampleRequests")
    @ResponseBody
    public JSONObject exampleRequests(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			List<String> examples = actionService.exampleRequests(lang, user.getDomainId());
			ret.put("success", true);
			ret.put("data", JSONObject.of("examples", examples));
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/action/save")
    @ResponseBody
    public JSONObject save(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			Action action = param.to(Action.class);
			action.setDomainId(user.getDomainId());
			actionService.save(action, lang);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/action/delete")
    @ResponseBody
    public JSONObject delete(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String id = param.getString("id");
			actionService.delete(id, lang);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/action/queryById")
    @ResponseBody
    public JSONObject queryById(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String id = param.getString("id");
			Action action = actionService.queryById(id);
			ret.put("success", true);
			ret.put("data", action);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/action/queryList")
    @ResponseBody
    public JSONObject queryList(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String status = param.getString("status");
			String className = param.getString("className");
			List<Action> actions = actionService.queryList(status, null, className, user.getDomainId());
			ret.put("success", true);
			ret.put("data", actions);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/action/re-explain")
	@ResponseBody
	public JSONObject reExplainActions(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang,
			@RequestBody(required = false) JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			List<String> ids = new ArrayList<String>();
			JSONArray array = param == null ? null : param.getJSONArray("ids");
			if (array != null) {
				for (int i = 0; i < array.size(); i++) {
					ids.add(array.getString(i));
				}
			}
			Boolean missingOnly = param == null ? null : param.getBoolean("missingOnly");
			ret.put("success", true);
			ret.put("data", actionService.reExplainActions(ids, missingOnly == null || missingOnly, lang));
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@GetMapping("/action/export")
	public ResponseEntity<byte[]> exportActions(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		try {
			byte[] data = actionService.exportActions(lang);
			return ResponseEntity.ok()
					.header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"actions.zip\"")
					.contentType(MediaType.APPLICATION_OCTET_STREAM)
					.body(data);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return ResponseEntity.internalServerError().build();
		}
	}

	@PostMapping("/action/import")
	@ResponseBody
	public JSONObject importActions(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang,
			@RequestParam("file") MultipartFile file,
			@RequestParam(value = "allowMissingExplanation", required = false, defaultValue = "false") boolean allowMissingExplanation) {
		JSONObject ret = new JSONObject();
		try {
			ret = actionService.importActions(file.getBytes(), lang, allowMissingExplanation);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/action/find")
    @ResponseBody
    public JSONObject find(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String question = param.getString("question");
			String className = param.getString("className");
			List<Action> actions;
			if (question == null || "".equals(question.trim())) {
				actions = actionService.queryList(Action.STATUS_PUBLISHED, null, className, user.getDomainId());
			} else {
				actions = actionService.find(question.trim(), className, user.getDomainId());
			}
			JSONArray actionDefs = new JSONArray();
			for (Action action : actions) {
				JSONObject actionDef = new JSONObject();
				actionDef.put("id", action.getId());
				actionDef.put("name", action.getName());
				actionDef.put("logic", action.getFunction().getLogic());
				actionDef.put("parameters", action.getFunction().getParameters());
				actionDef.put("returnDef", action.getFunction().getReturnDef());
				actionDef.put("definition", action.getDefinition());
				actionDefs.add(actionDef);
			}
			ret.put("success", true);
			ret.put("data", actionDefs);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/action/execute")
    @ResponseBody
    public JSONObject execute(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang,
    		@RequestParam("id") String id,
    		@RequestParam("param") String paramJson,
    		@RequestParam(value = "file", required = false) List<MultipartFile> files) {
		JSONObject ret = new JSONObject();
		List<Path> tempFiles = new ArrayList<Path>();
		try {
			UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
	    	User user = SystemUtils.getCurUser();
			JSONObject p = JSONObject.parseObject(paramJson);
			if (files != null && !files.isEmpty()) {
				for (String key : p.keySet()) {
					Object value = p.get(key);
					if (value instanceof JSONObject) {
						JSONObject vectorValue = (JSONObject) value;
						String uploadFile = vectorValue.getString("uploadFile");
						if (uploadFile != null && !"".equals(uploadFile.trim())) {
							int idx = Integer.parseInt(uploadFile.trim());
							MultipartFile file = files.get(idx);
							Path saved = saveTempFile(file);
							tempFiles.add(saved);
							vectorValue.put("uploadFilePath", saved.toAbsolutePath().toString());
							vectorValue.remove("uploadFile");
						}
					}
				}
			}
			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		int timeoutMinutes = Long.valueOf(businessConfig.getDslCookerTimeout() / 60000).intValue();
			if (timeoutMinutes <= 0) {
				timeoutMinutes = 1;
			}
			PythonExecuteResult result = actionService.execute(id, p, lang, user, curUserDataPermission, timeoutMinutes);
			if (result.getError() != null && !"".equals(result.getError().trim())) {
				throw new Exception(result.getError());
			}
			ret.put("success", true);
			ret.put("data", result);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		} finally {
			for (Path tempFile : tempFiles) {
				try {
					Files.deleteIfExists(tempFile);
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}
		return ret;
	}
	
	private Path saveTempFile(MultipartFile file) throws Exception {
		File dir = new File("conf/abcProgramWorkspaces/");
		dir.mkdirs();
		String name = UUID.randomUUID().toString() + "_" + file.getOriginalFilename();
		Path saved = Paths.get(dir.getPath(), name);
		Files.copy(file.getInputStream(), saved);
		return saved;
	}
	
}

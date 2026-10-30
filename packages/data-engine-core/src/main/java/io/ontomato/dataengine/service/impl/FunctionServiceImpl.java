package io.ontomato.dataengine.service.impl;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.dao.WriteTaskDao;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.FunctionService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.agent.OntologyGenerationPrompts;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
import io.ontomato.dataengine.util.DBSchemaUtil;
import jakarta.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Slf4j
@Service
public class FunctionServiceImpl implements FunctionService {

  @Autowired private AdminService adminService;

  @Autowired private BusinessConfigService businessConfigService;

  @Autowired private LangService langService;

  @Autowired private FunctionDao functionDao;

  @Autowired private MetricViewDao metricViewDao;

  @Autowired private ActionDao actionDao;

  @Autowired private WriteTaskDao writeTaskDao;

  @Autowired private OntologyGenerationService generationService;

  @PostConstruct
	public void initService() {
    	// Periodically clean up unreferenced read functions from 12 hours ago
    	new Thread(new Runnable() {
			@Override
			public void run() {
				Long timeoutTimeRange = 12 * 60 * 60 * 1000L;
				while (true) {
					try {
						Long now = System.currentTimeMillis();
						List<Function> functions = functionDao.queryList(Function.OPERATION_READ, null, null);
	                    Set<String> functionIds = metricViewDao.referencedFunctionIds();
					for (Function function : functions) {
							if (!Function.ORIGIN_SYSTEM.equals(function.getOrigin())) {
								if (!functionIds.contains(function.getId())) {
									if (now - function.getModifyTimestamp() > timeoutTimeRange) {
										functionDao.delete(function.getId());
									}
								}
							}
						}
					} catch (Exception e) {
						log.error(e.getMessage(), e);
					}
					try {
						Thread.sleep(60000L);
					} catch (Exception e) {}
				}
			}
    	}).start();
    	// Periodically clean up unreferenced write functions from 12 hours ago
    	new Thread(new Runnable() {
			@Override
			public void run() {
				Long timeoutTimeRange = 12 * 60 * 60 * 1000L;
				while (true) {
					try {
						Long now = System.currentTimeMillis();
						List<Function> functions = functionDao.queryList(Function.OPERATION_WRITE, null, null);
						Set<String> functionIds = new HashSet<String>();
						for (Object[] o : actionDao.queryList(null, null, null, null)) {
							String functionId = (String)o[1];
							functionIds.add(functionId);
						}
						for (Object[] o : writeTaskDao.queryList(null, null, null, null)) {
							String functionId = (String)o[1];
							functionIds.add(functionId);
						}
						for (Function function : functions) {
							if (!Function.ORIGIN_SYSTEM.equals(function.getOrigin())) {
								if (!functionIds.contains(function.getId())) {
									if (now - function.getModifyTimestamp() > timeoutTimeRange) {
										functionDao.delete(function.getId());
									}
								}
							}
						}
					} catch (Exception e) {
						log.error(e.getMessage(), e);
					}
					try {
						Thread.sleep(60000L);
					} catch (Exception e) {}
				}
			}
    	}).start();
    }

  @Override
  public Function generateFromABCProgram(
      String question,
      ABCHarnessProgram abcProgram,
      String lang,
      String domainId,
      String sessionId) {
    Function function = new Function();
    function.setOrigin(Function.ORIGIN_USER);
    function.setOperation(Function.OPERATION_READ);
    function.setDomainId(domainId);

    Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
    List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
    String originCode = abcProgram.getCode();

    String userMessage =
        OntologyGenerationPrompts.getReadFunctionMakerUserMessage(
            question, originCode, lang, langService, jsonRule);
    try (var generation =
        generationService.generate("function", sessionId, userMessage, lang, domainId)) {
      JSONObject envelope = generation.result();
      String code = envelope.getString("code");
      String name = envelope.getString("name");
      String logic = envelope.getString("logic");
      if (code == null || name == null || logic == null) {
        return null;
      }
      List<Parameter> parameters = new ArrayList<Parameter>();
      if (envelope.containsKey("parameterDefs")) {
        parameters =
            DBSchemaUtil.buildParameters(
                envelope.getJSONArray("parameterDefs").toList(Map.class), classDefs);
      }
      function.setName(name);
      function.setParameters(parameters);
      function.setCode(code);
      function.setLogic(logic);

      ReturnDef returnDef = new ReturnDef();
      returnDef.setIsVoid(false);
      List<ABCHarnessProgramOutKeyRef> outKeyRefs = abcProgram.getOutKeyRefs();
      List<String> classNames = new ArrayList<String>();
      for (ABCHarnessProgramOutKeyRef outKeyRef : outKeyRefs) {
        if (!classNames.contains(outKeyRef.getClassName())) {
          classNames.add(outKeyRef.getClassName());
        }
      }
      returnDef.setOutKeyRefs(outKeyRefs);
      returnDef.setClassNames(classNames);
      function.setReturnDef(returnDef);

      return generation.settle(() -> function);
    }
  }

  @Override
  public String generateBindingName(
      String question,
      List<Parameter> parameters,
      Function generalFunction,
      String lang,
      String sessionId) {
    if (generalFunction.getParameters().size() > 0) {
      String userMessage =
          OntologyGenerationPrompts.getStaticReadFunctionNameMakerUserMessage(
              generalFunction, parameters, lang, langService);
      try (var generation =
          generationService.generate(
              "name", sessionId, userMessage, lang, generalFunction.getDomainId())) {
        String name = generation.result().getString("name");
        if (name == null || name.isBlank()) return null;
        return generation.settle(() -> name);
      }
    }

    return null;
  }

  @Override
	public Function save(Function function, String lang) throws Exception {
		if (function.getId() != null) {
			Function existFunction = functionDao.queryById(function.getId());
			if (existFunction == null) {
				throw new Exception(langService.get(lang, "Function.notFound"));
			} else {
				if (Function.ORIGIN_SYSTEM.equals(function.getOrigin())) {
					throw new Exception(langService.get(lang, "Function.cannotModifySystem"));
				}
				if (!function.getDomainId().equals(existFunction.getDomainId())) {
					throw new Exception(langService.get(lang, "Function.domainMismatch"));
				}
			}
			// A referenced Function cannot be modified or deleted
			isReferenced(function.getId(), lang);
		}
		return functionDao.save(function);
	}

	private void isReferenced(String functionId, String lang) throws Exception {
		// A Function referenced by a MetricView cannot be modified or deleted
		if (metricViewDao.referencedFunctionIds().contains(functionId)) {
			throw new Exception(langService.get(lang, "Function.referencedByMetricView"));
		}
		// A Function referenced by an Action cannot be modified or deleted
		if (actionDao.queryList(null, functionId, null, null).size() > 0) {
			throw new Exception(langService.get(lang, "Function.referencedByAction"));
		}
		// A Function referenced by a WriteTask cannot be modified or deleted
		if (writeTaskDao.queryList(null, functionId, null, null).size() > 0) {
			throw new Exception(langService.get(lang, "Function.referencedByWriteTask"));
		}
	}

  @Override
	public void delete(String id, String lang) throws Exception {
		Function function = functionDao.queryById(id);
		if (function != null) {
			if (Function.ORIGIN_SYSTEM.equals(function.getOrigin())) {
				throw new Exception(langService.get(lang, "Function.cannotDeleteSystem"));
			}
			// A referenced Function cannot be modified or deleted
			isReferenced(function.getId(), lang);
			functionDao.delete(id);
		}
	}

  @Override
	public Function queryById(String id) {
		return functionDao.queryById(id);
	}

  @Override
	public List<Function> queryList(String operation, String className, String domainId) {
		return functionDao.queryList(operation, className, domainId);
	}
}

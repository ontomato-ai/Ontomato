package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.service.QueryPackage;
import io.ontomato.dataengine.service.QuerySourceSnapshot;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.service.scheduling.OntologyScheduleReferences;
import org.springframework.transaction.annotation.Transactional;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.FunctionForm;
import io.ontomato.dataengine.service.FunctionService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.PanelFormFields;
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

  @Autowired private OntologyScheduleReferences scheduledTasks;

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
						functionIds.addAll(scheduledTasks.referencedFunctions());
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

    Map<String, Object> jsonRule = generationService.authorizedRule(adminService.getJSONRule(domainId), domainId);
    List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
    var queryLogic = QuerySourceSnapshot.input(abcProgram);

    String userMessage =
        OntologyGenerationPrompts.getReadFunctionMakerUserMessage(
            question, queryLogic, lang, langService, jsonRule);
    try (var generation =
        generationService.generate("function", sessionId, userMessage, lang, domainId)) {
      JSONObject envelope = generation.result();
      if (!(envelope.get("queryPackage") instanceof JSONObject)) throw new IllegalArgumentException("queryPackage: expected JSONObject; supply this field with its declared JSON type");
      if (!(envelope.get("name") instanceof String)) throw new IllegalArgumentException("name: expected String; supply this field with its declared JSON type");
      if (!(envelope.get("logic") instanceof String)) throw new IllegalArgumentException("logic: expected String; supply this field with its declared JSON type");
      JSONObject bundle = envelope.getJSONObject("queryPackage");
      String name = envelope.getString("name");
      String logic = envelope.getString("logic");

      function.setName(name);
      function.setQueryPackage(bundle);
      function.setLogic(logic);

      ReturnDef returnDef = new ReturnDef();
      returnDef.setIsVoid(false);
      returnDef.setColumnLabels(envelope.getJSONObject("columnLabels"));
      function.setReturnDef(returnDef);
      QueryPackage.prepareReadFunction(function, classDefs);

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
	@Transactional(rollbackFor = Exception.class)
	public Function save(Function function, String lang) throws Exception {
        if (Function.OPERATION_READ.equals(function.getOperation()))
            QueryPackage.prepareReadFunction(function,
                (List<Map<String, Object>>) adminService.getJSONRule(function.getDomainId()).get("classDef"));
		if (function.getId() != null) {
			functionDao.lock(function.getId());
			Function existFunction = functionDao.queryById(function.getId());
			if(existFunction!=null&&Function.OPERATION_PRODUCT.equals(existFunction.getOperation()))throw new OwnerRefusal("FUNCTION_PRODUCT_IMMUTABLE", "Published product Function artifacts are immutable");
			if (existFunction == null) {
				throw new OwnerRefusal("FUNCTION_NOT_FOUND", langService.get(lang, "Function.notFound"));
			} else {
				if (Function.ORIGIN_SYSTEM.equals(function.getOrigin())) {
					throw new OwnerRefusal("FUNCTION_SYSTEM", langService.get(lang, "Function.cannotModifySystem"));
				}
				if (!function.getDomainId().equals(existFunction.getDomainId())) {
					throw new OwnerRefusal("FUNCTION_DOMAIN_MISMATCH", langService.get(lang, "Function.domainMismatch"));
				}
			}
			// A referenced Function cannot be modified or deleted
			isReferenced(function.getId(), lang);
		}
		return functionDao.save(function, lang);
	}

	private void isReferenced(String functionId, String lang) throws Exception {
		String reason = referenceReason(functionId, lang);
		if (reason != null) throw new OwnerRefusal("FUNCTION_REFERENCED", reason);
	}

	/** Why a Function cannot change, or null when no MetricView, Action or WriteTask references it. */
	private String referenceReason(String functionId, String lang) {
		if (metricViewDao.referencedFunctionIds().contains(functionId))
			return langService.get(lang, "Function.referencedByMetricView");
		if (actionDao.queryList(null, functionId, null, null).size() > 0)
			return langService.get(lang, "Function.referencedByAction");
		if (scheduledTasks.references(functionId))
			return langService.get(lang, "Function.referencedByWriteTask");
		return null;
	}

  @Override
	@Transactional(rollbackFor = Exception.class)
	public void delete(String id, String lang) throws Exception {
		functionDao.lock(id);
		Function function = functionDao.queryById(id);
		if (function != null) {
			if(Function.OPERATION_PRODUCT.equals(function.getOperation()))throw new OwnerRefusal("FUNCTION_PRODUCT_IMMUTABLE", "Published product Function artifacts are retained by their release records");
			if (Function.ORIGIN_SYSTEM.equals(function.getOrigin())) {
				throw new OwnerRefusal("FUNCTION_SYSTEM", langService.get(lang, "Function.cannotDeleteSystem"));
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

  @Override
  public JSONObject form(JSONObject request, String lang, String domainId) {
    JSONObject target = request.getJSONObject("target");
    if (target == null) throw new IllegalArgumentException("target is required");
    String kind = target.getString("kind");
    boolean existing;
    Function function;
    if ("object".equals(kind)) {
      if (!"platform:Function".equals(target.getString("objectType")))
        throw new IllegalArgumentException("target.objectType: expected platform:Function");
      String primaryKey = target.getString("primaryKey");
      if (primaryKey == null || primaryKey.isBlank())
        throw new IllegalArgumentException("target.primaryKey: expected a function id");
      function = functionDao.queryById(primaryKey);
      if (function == null || !domainId.equals(function.getDomainId()))
        throw new OwnerRefusal("FUNCTION_NOT_FOUND", "Function not found");
      existing = true;
    } else if ("draft".equals(kind)) {
      function = FunctionForm.defaultValues().to(Function.class);
      function.setDomainId(domainId);
      existing = false;
    } else {
      throw new IllegalArgumentException("target.kind: expected object or draft");
    }
    JSONObject values = request.getJSONObject("values");
    if (values == null) values = PanelFormFields.asset(function);
    else if (request.get("changedField") == null) FunctionForm.checkDraft(values);
    String readOnlyReason = null;
    if (Function.ORIGIN_SYSTEM.equals(function.getOrigin()))
      readOnlyReason = langService.get(lang, "Function.cannotModifySystem");
    else if (Function.OPERATION_PRODUCT.equals(function.getOperation()))
      readOnlyReason = langService.get(lang, "PanelForm.readOnly.product");
    else if (function.getId() != null)
      readOnlyReason = referenceReason(function.getId(), lang);
    String operationReadOnlyReason = langService.get(lang, "PanelForm.readOnly.operation");
    return FunctionForm.describe(values, existing, readOnlyReason, operationReadOnlyReason, lang, langService);
  }
}

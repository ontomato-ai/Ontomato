package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.service.authorization.CapabilityDefinitions;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.DefinitionFirstPublication;
import io.ontomato.dataengine.service.authorization.DefinitionFirstPublication.Selection;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Create;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import static io.ontomato.dataengine.service.authorization.CapabilityDefinitions.access;
import static io.ontomato.dataengine.service.authorization.CapabilityDefinitions.functionKind;

import io.ontomato.dataengine.service.QueryPackage;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.service.scheduling.OntologyScheduleReferences;
import org.springframework.transaction.annotation.Transactional;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.FunctionForm;
import io.ontomato.dataengine.service.FunctionService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.OwnerFieldRefusal;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.service.PanelFormFields;
import io.ontomato.dataengine.util.DBSchemaUtil;
import jakarta.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Slf4j
@Service
public class FunctionServiceImpl implements FunctionService {

  @Autowired private AdminService adminService;

  @Autowired private LangService langService;

  @Autowired private FunctionDao functionDao;
  @Autowired private CapabilityDefinitions definitions;
  @Autowired private DefinitionFirstPublication firstPublication;

  @Autowired private MetricViewDao metricViewDao;

  @Autowired private ActionDao actionDao;

  @Autowired private OntologyScheduleReferences scheduledTasks;

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
	@Transactional(rollbackFor = Exception.class)
    public Function save(Function function, String lang, Selection publication) throws Exception {
        if (!Function.OPERATION_READ.equals(function.getOperation()) && !Function.OPERATION_WRITE.equals(function.getOperation()))
            throw new IllegalArgumentException("Function.operation: expected OPERATION_READ or OPERATION_WRITE");
        var subject = definitions.current();
        var kind = functionKind(function.getOperation());
        boolean firstPublish = false;
        if (function.getId() == null) {
            definitions.require(subject, new Create(kind));
            function.setCreatedBy(subject.identity().userId());
            function.setOrigin(Function.ORIGIN_USER);
            boolean read = Function.OPERATION_READ.equals(function.getOperation());
            function.setPublished(!read || publication != null || !firstPublication.requiresSelection());
            firstPublish = read && function.isPublished();
        } else {
            functionDao.lock(function.getId());
            Function stored = functionDao.queryById(function.getId());
            if (stored == null || !function.getDomainId().equals(stored.getDomainId()))
                throw new OwnerRefusal("FUNCTION_NOT_FOUND", langService.get(lang, "Function.notFound"));
            if (Function.OPERATION_PRODUCT.equals(stored.getOperation()))
                throw new OwnerRefusal("FUNCTION_PRODUCT_IMMUTABLE", langService.get(lang, "PanelForm.readOnly.product"));
            definitions.require(subject, access(stored, Verb.EDIT));
            if (Function.ORIGIN_SYSTEM.equals(stored.getOrigin()))
                throw new OwnerRefusal("FUNCTION_SYSTEM", langService.get(lang, "Function.cannotModifySystem"));
            if (!stored.getOperation().equals(function.getOperation()))
                throw new OwnerRefusal("FUNCTION_OPERATION_IMMUTABLE", langService.get(lang, "PanelForm.readOnly.operation"));
            isReferenced(function.getId(), lang);
            function.setOrigin(stored.getOrigin());
            function.setCreatedBy(stored.getCreatedBy());
            function.setCreateTimestamp(stored.getCreateTimestamp());
            firstPublish = !stored.isPublished() && publication != null;
            function.setPublished(stored.isPublished() || firstPublish);
        }
        if (Function.OPERATION_READ.equals(function.getOperation())) {
            try {
                QueryPackage.prepareReadFunction(function,
                    (List<Map<String, Object>>) adminService.getJSONRule(function.getDomainId()).get("classDef"));
            } catch (IllegalArgumentException error) {
                throw new OwnerFieldRefusal("FUNCTION_QUERY_PACKAGE_INVALID", "/queryPackage", "invalid_object", error.getMessage());
            }
        }
        Function saved = functionDao.save(function, lang);
        if (firstPublish) firstPublication.grantUse(subject, access(saved, Verb.USE).target(), publication);
        return saved;
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

  /** Why this Function cannot be deleted, or null when it can: a product, a system Function, or a referenced one. */
	private OwnerRefusal deletionRefusal(Function function, String lang) {
		if (Function.OPERATION_PRODUCT.equals(function.getOperation()))
			return new OwnerRefusal("FUNCTION_PRODUCT_IMMUTABLE", langService.get(lang, "Function.cannotDeleteProduct"));
		OwnerRefusal system = OwnerRefusal.systemAssetDeletion(function.getOrigin(), "FUNCTION_SYSTEM",
				() -> langService.get(lang, "Function.cannotDeleteSystem"));
		if (system != null) return system;
		String reason = referenceReason(function.getId(), lang);
		return reason == null ? null : new OwnerRefusal("FUNCTION_REFERENCED", reason);
	}

  @Override
	@Transactional(rollbackFor = Exception.class)
	public void delete(String id, String domainId, String lang) throws Exception {
		functionDao.lock(id);
		Function function = functionDao.queryById(id);
		if (function == null || !domainId.equals(function.getDomainId())) return;
		if (!Function.OPERATION_PRODUCT.equals(function.getOperation()))
            definitions.require(definitions.current(), access(function, Verb.EDIT));
        OwnerRefusal refusal = deletionRefusal(function, lang);
		if (refusal != null) throw refusal;
		functionDao.delete(id);
	}

  @Override
	public String deleteRefusal(String id, String lang, SubjectContext subject) {
		Function function = functionDao.queryById(id);
		if (function == null || !subject.identity().domainId().equals(function.getDomainId()))
			throw new OwnerRefusal("FUNCTION_NOT_FOUND", langService.get(lang, "Function.notFound"));
		if (!Function.OPERATION_PRODUCT.equals(function.getOperation()))
            definitions.require(subject, access(function, Verb.EDIT));
        OwnerRefusal refusal = deletionRefusal(function, lang);
		return refusal == null ? null : refusal.getMessage();
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
  public List<Function> listVisible(String operation, String className, SubjectContext subject) {
    var visible = visibleTo(subject);
    return queryList(operation, className, subject.identity().domainId()).stream().filter(visible).toList();
  }

  @Override
  public Optional<Function> visibleDefinition(String id, SubjectContext subject) {
    return functionDao.queryReadCandidates(subject.identity().domainId(), id).stream()
        .filter(visibleTo(subject)).findFirst();
  }

  @Override
  public List<Function> visibleDefinitions(Set<String> ids, SubjectContext subject) {
    return functionDao.queryReadCandidates(subject.identity().domainId(), ids).stream()
        .filter(visibleTo(subject)).toList();
  }

  @Override
  public List<FunctionDao.ObjectTypeReferences> visibleObjectTypeReferences(String centerId, boolean outgoing, SubjectContext subject) {
    var visible = visibleTo(subject);
    return functionDao.objectTypeReferences(subject.identity().domainId(), centerId, outgoing).stream()
        .filter(row -> visible.test(row.definition())).toList();
  }

  @Override
  public long countVisible(SubjectContext subject) {
    var domainId = subject.identity().domainId();
    var ids = functionDao.queryReadCandidates(domainId).stream()
        .filter(visibleTo(subject)).map(Function::getId).toList();
    return functionDao.countByIds(domainId, ids);
  }

  private Predicate<Function> visibleTo(SubjectContext subject) {
    return function -> Function.OPERATION_PRODUCT.equals(function.getOperation())
        || definitions.canRead(subject, access(function, Verb.USE));
  }

  @Override
  public JSONObject form(JSONObject request, String lang, SubjectContext subject) {
    String domainId = subject.identity().domainId();
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
        throw new OwnerRefusal("FUNCTION_NOT_FOUND", langService.get(lang, "Function.notFound"));
      if (!Function.OPERATION_PRODUCT.equals(function.getOperation()))
          definitions.requireRead(subject, access(function, Verb.USE));
      existing = true;
    } else if ("draft".equals(kind)) {
      var values = request.getJSONObject("values");
      if (values != null && values.getString("operation") != null) {
          definitions.require(subject, new Create(functionKind(values.getString("operation"))));
      } else if (!definitions.allows(subject, new Create(functionKind(Function.OPERATION_WRITE)))) {
          definitions.require(subject, new Create(functionKind(Function.OPERATION_READ)));
      }
      function = FunctionForm.defaultValues().to(Function.class);
      function.setDomainId(domainId);
      existing = false;
    } else {
      throw new IllegalArgumentException("target.kind: expected object or draft");
    }
    JSONObject values = request.getJSONObject("values");
    // A stored Function and a refresh carry no verdict; an incoming draft is checked and its errors returned with it.
    List<ObjectNode> errors = List.of();
    JSONObject current = PanelFormFields.definitionValues(function, !existing);
    FunctionForm.labelColumnsFromAnalysis(current);
    if (values == null) {
      values = current;
    } else {
      // Submitted values are laid over the current definition: a field a draft leaves out keeps its value.
      values = PanelFormFields.withDraft(current, values);
      if (request.get("changedField") == null) errors = FunctionForm.fieldErrors(values);
    }
    String readOnlyReason = null;
    if (Function.ORIGIN_SYSTEM.equals(function.getOrigin()))
      readOnlyReason = langService.get(lang, "Function.cannotModifySystem");
    else if (Function.OPERATION_PRODUCT.equals(function.getOperation()))
      readOnlyReason = langService.get(lang, "PanelForm.readOnly.product");
    else if (function.getId() != null)
      readOnlyReason = referenceReason(function.getId(), lang);
    String operationReadOnlyReason = langService.get(lang, "PanelForm.readOnly.operation");
    return FunctionForm.describe(values, errors, existing, readOnlyReason, operationReadOnlyReason, lang, langService);
  }
}

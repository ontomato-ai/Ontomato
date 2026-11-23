package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.WorkflowPendingQuery;
import io.ontomato.dataengine.service.ExecutionTarget;
import io.ontomato.dataengine.service.QueryPackage;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewBinding;
import io.ontomato.dataengine.service.MetricViewBindings;
import io.ontomato.dataengine.service.FunctionForm;
import io.ontomato.dataengine.service.MetricViewForm;
import io.ontomato.dataengine.service.OwnerFieldRefusal;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.service.PanelFormFields;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.Objects;
import io.ontomato.dataengine.bean.metricView.MetricViewContent;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.dataAdapter.DslRowLimit;
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.MetricViewService;
import io.ontomato.dataengine.service.MetricRecall;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.SubjectReference;
import io.ontomato.dataengine.service.SubjectValueResolver;
import io.ontomato.dataengine.service.ParameterForms;
import io.ontomato.dataengine.schedules.ScheduleJson;
import io.ontomato.dataengine.service.SessionCancelledException;
import io.ontomato.dataengine.service.agent.OntologyGenerationPrompts;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
import io.ontomato.dataengine.service.agent.AgentJson;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DBSchemaUtil;
import io.ontomato.dataengine.util.SystemUtils;
import io.ontomato.dataengine.util.ZipBundleUtil;
import jakarta.annotation.PostConstruct;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@Slf4j
@Service
public class MetricViewServiceImpl implements MetricViewService {

  @Autowired private MetricViewDao metricViewDao;

  @Autowired private FunctionDao functionDao;

  @Autowired private BusinessConfigService businessConfigService;

  @Autowired private SubjectValueResolver subjectValues;
  @Autowired private WorkflowPendingQuery pending;

  @Autowired private KnowledgeDao knowledgeDao;

  @Autowired private AdminService adminService;

  @Autowired private ABCProgramService abcProgramService;

  @Autowired private LangService langService;

  @Autowired private OntologyGenerationService generationService;

  @Autowired private PlatformTransactionManager transactionManager;

  @Autowired private IdentityService identityService;

  @PostConstruct
	public void initService() {
		// Periodically clean up unpublished metricViews from 12 hours ago
		new Thread(new Runnable() {
			@Override
			public void run() {
				Long timeoutTimeRange = 12 * 60 * 60 * 1000L;
				while (true) {
					try {
						Long now = System.currentTimeMillis();
						List<Object[]> oList = metricViewDao.queryList(MetricView.STATUS_PENDING_REVIEW, null, null, null);
						for (Object[] o : oList) {
							MetricView metricView = (MetricView)o[0];
							if (!metricView.isAdopted() && !MetricView.ORIGIN_SYSTEM.equals(metricView.getOrigin())) {
								if (now - metricView.getModifyTimestamp() > timeoutTimeRange) {
									metricViewDao.delete(metricView.getId(), metricView.getDomainId());
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
  public MetricView generateFromNatureLanguage(
      String question, String lang, String domainId, boolean persistence) throws Exception {
    Map<String, Object> jsonRule = generationService.authorizedRule(adminService.getJSONRule(domainId), domainId);
    List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
    String port =
        businessConfigService
                .getRuntimeWholeConfig(domainId)
                .getJSONObject("server")
                .getInteger("port")
            + "";

    String sessionId = UUID.randomUUID().toString();

    String userMessage =
        OntologyGenerationPrompts.getMetricViewMakerUserMessage(
            question,
            port,
            knowledgeDao,
            businessConfigService,
            lang,
            langService,
            jsonRule,
            domainId);
    try (var generation =
        generationService.generateMetricView(sessionId, userMessage, lang, domainId)) {
      JSONObject envelope = generation.result();
      if (!(envelope.get("queryPackage") instanceof JSONObject)) throw new IllegalArgumentException("queryPackage: expected JSONObject; supply this field with its declared JSON type");
      if (!(envelope.get("name") instanceof String)) throw new IllegalArgumentException("name: expected String; supply this field with its declared JSON type");
      if (!(envelope.get("logic") instanceof String)) throw new IllegalArgumentException("logic: expected String; supply this field with its declared JSON type");
      JSONObject bundle = envelope.getJSONObject("queryPackage");
      String name = envelope.getString("name");
      String logic = envelope.getString("logic");

      Function function = new Function();
      function.setOrigin(Function.ORIGIN_USER);
      function.setOperation(Function.OPERATION_READ);
      function.setDomainId(domainId);
      function.setName(name);
      function.setQueryPackage(bundle);
      function.setLogic(logic);

      ReturnDef returnDef = new ReturnDef();
      returnDef.setIsVoid(false);
      returnDef.setColumnLabels(envelope.getJSONObject("columnLabels"));
      function.setReturnDef(returnDef);
      QueryPackage.prepareReadFunction(function, classDefs);

      MetricView metricView = generateFromFunction(function);
      metricView.setStatus(MetricView.STATUS_PUBLISHED);
      Set<String> matchQuestions = new HashSet<String>();
      matchQuestions.add(question);
      metricView.setMatchQuestions(matchQuestions);
      return generation.settle(
          () -> {
            if (persistence) {
              return save(metricView, lang);
            }
            return metricView;
          });
    }
  }

  @Override
	public MetricView generateFromFunction(Function function) {
		MetricView metricView = new MetricView();
		metricView.setName(function.getName());
		metricView.setOrigin(function.getOrigin());
		metricView.setFunction(function);
		metricView.setStatus(MetricView.STATUS_PENDING_REVIEW);
		metricView.setDomainId(function.getDomainId());
        metricView.setBindings(new ArrayList<>());
		return metricView;
	}

  @Override
  public MetricView save(MetricView metric, String lang) {
    return new TransactionTemplate(transactionManager).execute(status -> persist(metric, WriteKind.SAVE, lang));
  }

  @Override
  public MetricView saveAdoptedCandidate(MetricView metric, User user, String lang) {
    metric.setDomainId(user.getDomainId());
    metric.setCreatedBy(user.getId());
    metric.setStatus(MetricView.STATUS_PENDING_REVIEW);
    return new TransactionTemplate(transactionManager).execute(status -> persist(metric, WriteKind.ADOPTION, lang));
  }

  @Override
  public MetricView publishWorkflowMetric(MetricView metric, String lang) {
    return new TransactionTemplate(transactionManager).execute(status -> persist(metric, WriteKind.WORKFLOW_PUBLICATION, lang));
  }

  private enum WriteKind { SAVE, IMPORT, ADOPTION, WORKFLOW_PUBLICATION }

  private MetricView persist(MetricView metric, WriteKind kind, String lang) {
    String domain = Objects.requireNonNull(metric.getDomainId(), "Current domain is required");
    MetricView previous = null;
    if (metric.getId() != null) {
      metricViewDao.lock(metric.getId(), domain);
      previous = queryById(metric.getId(), domain);
      if (previous == null && (kind != WriteKind.IMPORT || metricViewDao.exists(metric.getId())))
        throw new OwnerRefusal("METRIC_VIEW_NOT_FOUND", langService.get(lang, "MetricView.notFound"));
      if (previous != null && MetricView.ORIGIN_SYSTEM.equals(previous.getOrigin()))
        throw new OwnerRefusal("METRIC_VIEW_SYSTEM", "Cannot modify a system MetricView");
    }
    if (kind != WriteKind.WORKFLOW_PUBLICATION) {
      var source = previous == null ? null : previous.getWorkflowSource();
      if (previous != null && previous.isWorkflowPending())
        throw new OwnerRefusal("METRIC_VIEW_WORKFLOW_PENDING", "Edit the workflow to change its pending query");
      if (metric.getWorkflowSource() != null && !metric.getWorkflowSource().equals(source))
        throw new OwnerRefusal("METRIC_VIEW_WORKFLOW_SOURCE", "Only workflow publication can assign a metric source");
      metric.setWorkflowSource(source);
    }
    if (metric.getBindings() == null)
      metric.setBindings(previous == null ? new ArrayList<>() : previous.getBindings());
    if (kind != WriteKind.IMPORT) {
      Set<String> owned = new HashSet<>();
      if (previous != null) for (var binding : previous.getBindings()) owned.add(binding.getId());
      List<MetricViewBinding> bindings = metric.getBindings();
      for (int i = 0; i < bindings.size(); i++)
        if (bindings.get(i).getId() != null && !owned.contains(bindings.get(i).getId()))
          throw new OwnerFieldRefusal("METRIC_VIEW_BINDING_NOT_FOUND", "/bindings/" + i + "/id", "target_unavailable",
              "Metric binding not found");
    }
    Function function = Objects.requireNonNull(metric.getFunction(), "Function is required");
    if (!Function.OPERATION_READ.equals(function.getOperation()))
      throw new OwnerRefusal("METRIC_VIEW_FUNCTION_INVALID", "MetricView requires a read Function");
    if (function.getId() != null) {
      Function stored = functionDao.queryById(function.getId());
      if (stored == null && kind != WriteKind.IMPORT)
        throw new OwnerRefusal("METRIC_VIEW_FUNCTION_INVALID", "Function not found");
      if (stored != null && (!domain.equals(stored.getDomainId()) || !Function.OPERATION_READ.equals(stored.getOperation())))
        throw new OwnerRefusal("METRIC_VIEW_FUNCTION_INVALID", "Read Function not found");
      if (stored != null) {
        function.setOrigin(stored.getOrigin());
        function.setCreateTimestamp(stored.getCreateTimestamp());
      }
    }
    function.setDomainId(domain);
    try {
      QueryPackage.prepareReadFunction(function,
          (List<Map<String, Object>>) adminService.getJSONRule(domain).get("classDef"));
    } catch (IllegalArgumentException error) {
      throw new OwnerFieldRefusal("METRIC_VIEW_QUERY_PACKAGE_INVALID", QUERY_PACKAGE, "invalid_object", error.getMessage());
    }
    if (function.getOrigin() == null) function.setOrigin(Function.ORIGIN_USER);
    validateBindings(function, metric.getBindings(), true);
    validateSubjectReferences(function, metric.getBindings(), true);
    List<MetricView> sharing = function.getId() == null ? List.of() : queryList(null, function.getId(), null, domain);
    for (MetricView other : sharing)
      if (!Objects.equals(other.getId(), metric.getId())) {
        validateBindings(function, other.getBindings(), false);
        validateSubjectReferences(function, other.getBindings(), false);
      }
    metric.setOrigin(previous == null ? MetricView.ORIGIN_USER : previous.getOrigin());
    metric.setCreateTimestamp(previous == null ? null : previous.getCreateTimestamp());
    metric.setAdopted(kind == WriteKind.ADOPTION || previous != null && previous.isAdopted());
    // Provenance is resolved here rather than at a controller, because generation and import reach the
    // same funnel without passing a request body: one place to set it, no path that forgets.
    String subject = currentSubjectId();
    if (previous != null) {
      metric.setCreatedBy(previous.getCreatedBy());
    } else if (metric.getCreatedBy() == null) {
      metric.setCreatedBy(subject);
    }
    if (MetricView.STATUS_PUBLISHED.equals(metric.getStatus()) && subject != null) {
      metric.setReviewedBy(subject);
    } else if (previous != null && metric.getReviewedBy() == null) {
      metric.setReviewedBy(previous.getReviewedBy());
    }
    functionDao.save(function, lang);
    metricViewDao.save(metric);
    // A shared definition's class projection follows the same edit as its bindings.
    for (MetricView other : sharing) {
      if (Objects.equals(other.getId(), metric.getId())) continue;
      other.setFunction(function);
      metricViewDao.save(other);
    }
    return metric;
  }

  /**
   * Refuse a definition whose subject reference could never resolve.
   *
   * <p>This runs at save, not only at execution: a reference written as {@code {{acount.id}}} is a
   * literal that matches nothing, so the metric would publish happily and then answer "no rows" forever.
   * Catching it while the author is still editing is the difference between a typo and a silent outage.</p>
   */
  private void validateSubjectReferences(Function function, List<MetricViewBinding> bindings, boolean atField) {
    if (function.getParameters() != null) {
      for (Parameter parameter : function.getParameters()) {
        try {
          subjectValues.validate(parameter.getValue());
        } catch (IllegalArgumentException error) {
          throw refusal("METRIC_VIEW_PARAMETER_INVALID", atField ? QUERY_PACKAGE : null,
              "Parameter '" + parameter.getName() + "': " + error.getMessage());
        }
      }
    }
    if (bindings == null) return;
    for (int i = 0; i < bindings.size(); i++) {
      if (bindings.get(i).getParameters() == null) continue;
      try {
        subjectValues.validateValues(bindings.get(i).getParameters());
      } catch (IllegalArgumentException error) {
        throw refusal("METRIC_VIEW_PARAMETER_INVALID", atField ? "/bindings/" + i + "/parameters" : null, error.getMessage());
      }
    }
  }

  /**
   * The binding rules as this owner's refusal; {@link MetricViewBindings} stays the single judge. {@code atField} names
   * the saved metric's bindings, a field of its form where the draft check reports the same rule; another metric sharing
   * the Function, an appended binding and a trial have no field to mark.
   */
  private static void validateBindings(Function function, List<MetricViewBinding> bindings, boolean atField) {
    try {
      MetricViewBindings.validate(function, bindings);
    } catch (IllegalArgumentException error) {
      throw refusal("METRIC_VIEW_BINDING_INVALID", atField ? "/bindings" : null, error.getMessage());
    }
  }

  /** The metric form's pointer to the definition a saved Function's rules judge. */
  private static final String QUERY_PACKAGE = "/function/queryPackage";

  private static OwnerRefusal refusal(String code, String field, String message) {
    return field == null ? new OwnerRefusal(code, message) : new OwnerFieldRefusal(code, field, "invalid_object", message);
  }

  /**
   * The authenticated subject, or null when there is none. Absence is tolerated rather than fatal: a
   * background or anonymous run must still be able to persist, it just records no provenance.
   */
  private String currentSubjectId() {
    try {
      return identityService == null ? null : identityService.getCurrentUserId();
    } catch (RuntimeException noIdentity) {
      return null;
    }
  }

  @Override
  public MetricView appendBinding(String id, MetricViewBinding binding, String domainId) {
    return recordMatch(id, null, binding, domainId);
  }

  private MetricView recordMatch(String id, String question, MetricViewBinding binding, String domainId) {
    return new TransactionTemplate(transactionManager).execute(status -> {
      metricViewDao.lock(id, domainId);
      MetricView metric = queryById(id, domainId);
      if (metric == null) throw new IllegalArgumentException("MetricView not found");
      if (question != null) metric.getMatchQuestions().add(question.trim());
      if (binding != null) {
        if (binding.getId() != null) throw new IllegalArgumentException("A new binding cannot choose an ID");
        MetricViewBindings.validate(metric.getFunction(), List.of(binding));
        validateSubjectReferences(metric.getFunction(), List.of(binding), false);
        String parameters = AgentJson.canonical(binding.getParameters());
        if (metric.getBindings().stream()
            .anyMatch(existing -> parameters.equals(AgentJson.canonical(existing.getParameters()))))
          return metric;
        metric.getBindings().add(binding);
      }
      MetricViewBindings.validate(metric.getFunction(), metric.getBindings());
      return metricViewDao.save(metric);
    });
  }

  @Override
  public void delete(String id, String domainId, String lang) {
    MetricView metric = queryById(id, domainId);
    if (metric == null) throw new OwnerRefusal("METRIC_VIEW_NOT_FOUND", langService.get(lang, "MetricView.notFound"));
    OwnerRefusal refusal = systemDeletionRefusal(metric, lang);
    if (refusal != null) throw refusal;
    metricViewDao.delete(id, domainId);
  }

  @Override
  public String systemDeletionRefusal(String id, String domainId, String lang) {
    MetricView metric = queryById(id, domainId);
    if (metric == null) throw new OwnerRefusal("METRIC_VIEW_NOT_FOUND", langService.get(lang, "MetricView.notFound"));
    OwnerRefusal refusal = systemDeletionRefusal(metric, lang);
    return refusal == null ? null : refusal.getMessage();
  }

  private OwnerRefusal systemDeletionRefusal(MetricView metric, String lang) {
    return OwnerRefusal.systemAssetDeletion(metric.getOrigin(), "METRIC_VIEW_SYSTEM",
        () -> langService.get(lang, "MetricView.cannotDeleteSystem"));
  }

  private MetricView hydrate(Object[] tuple, String domainId) {
    MetricView metric = (MetricView) tuple[0];
    Function function = functionDao.queryById((String) tuple[1]);
    if (!domainId.equals(metric.getDomainId()) || function == null || !domainId.equals(function.getDomainId())
        || !Function.OPERATION_READ.equals(function.getOperation()))
      throw new IllegalStateException("MetricView read Function is missing or belongs to another domain");
    metric.setFunction(function);
    return metric;
  }

  @Override
  public List<MetricView> pendingForRetrieval(String domainId, String cursor, List<String> classes, int limit) {
    return metricViewDao.queryForRetrieval(domainId, "", cursor, classes, limit, true).stream().map(row -> hydrate(row, domainId)).toList();
  }

  @Override
  public List<MetricView> queryForRetrieval(String domainId, String query, String cursor, List<String> classes, int limit) {
    return metricViewDao.queryForRetrieval(domainId, query, cursor, classes, limit, false).stream()
        .map(row -> hydrate(row, domainId)).toList();
  }

  @Override
  public List<MetricRecall> recall(String question, String domainId, double maxDistance, int maxRows) {
    return metricViewDao.recall(question, domainId, maxDistance, maxRows);
  }

  @Override
  public MetricView queryById(String id, String domainId) {
    Objects.requireNonNull(domainId, "Current domain is required");
    Object[] row = metricViewDao.queryById(id, domainId);
    return row == null ? null : hydrate(row, domainId);
  }

  @Override
  public MetricView requireExecutable(String id, User user) {
    MetricView metric = queryById(id, user.getDomainId());
    if (metric == null)
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Executable read metric not found");
    requireExecutableState(metric, user);
    return metric;
  }

  private void requireExecutableState(MetricView metric, User user) {
    if (!executable(metric, user))
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Executable read metric not found");
  }

  /** Published, or the caller's own pending candidate; the one rule both execution entrances read. */
  private static boolean executable(MetricView metric, User user) {
    boolean ownCandidate = metric.getId() != null
        && MetricView.STATUS_PENDING_REVIEW.equals(metric.getStatus())
        && user.getId().equals(metric.getCreatedBy());
    return MetricView.STATUS_PUBLISHED.equals(metric.getStatus()) || ownCandidate;
  }

  @Override
  public List<MetricView> queryList(String status, String functionId, String className, String domainId) {
    Objects.requireNonNull(domainId, "Current domain is required");
    return metricViewDao.queryList(status, functionId, className, domainId).stream().map(row -> hydrate(row, domainId)).toList();
  }

  @Override
  public JSONObject form(JSONObject request, String lang, String domainId) {
    JSONObject target = request.getJSONObject("target");
    if (target == null) throw new IllegalArgumentException("target is required");
    String kind = target.getString("kind");
    boolean existing;
    MetricView metric;
    if ("object".equals(kind)) {
      if (!"platform:MetricView".equals(target.getString("objectType")))
        throw new IllegalArgumentException("target.objectType: expected platform:MetricView");
      String primaryKey = target.getString("primaryKey");
      if (primaryKey == null || primaryKey.isBlank())
        throw new IllegalArgumentException("target.primaryKey: expected a metric id");
      metric = queryById(primaryKey, domainId);
      if (metric == null) throw new OwnerRefusal("METRIC_VIEW_NOT_FOUND", langService.get(lang, "MetricView.notFound"));
      existing = true;
    } else if ("draft".equals(kind)) {
      metric = MetricViewForm.defaults().to(MetricView.class);
      metric.setDomainId(domainId);
      metric.getFunction().setDomainId(domainId);
      existing = false;
    } else {
      throw new IllegalArgumentException("target.kind: expected object or draft");
    }
    JSONObject values = request.getJSONObject("values");
    // A stored metric and a refresh carry no verdict; an incoming draft is checked and its errors returned with it.
    List<ObjectNode> errors = List.of();
    JSONObject current = PanelFormFields.asset(metric);
    // A new definition has no ID yet; its form must not offer one for the create to carry.
    if (!existing) current.remove("id");
    FunctionForm.labelColumnsFromAnalysis(current.getJSONObject("function"));
    if (values == null) {
      values = current;
    } else {
      // Submitted values are laid over the current definition: a field a draft leaves out keeps its value.
      values = PanelFormFields.withDraft(current, values);
      if (request.get("changedField") == null) errors = MetricViewForm.fieldErrors(values);
    }
    String readOnlyReason = null;
    if (metric.isWorkflowPending()) readOnlyReason = langService.get(lang, "PanelForm.readOnly.workflowPending");
    else if (MetricView.ORIGIN_SYSTEM.equals(metric.getOrigin()))
      readOnlyReason = langService.get(lang, "MetricView.cannotModifySystem");
    return MetricViewForm.describe(values, errors, existing, readOnlyReason, lang, langService);
  }

  @Override
  public List<StatusResult> setStatus(String domainId, List<String> ids, String status, String lang) {
    if (ids == null || ids.isEmpty())
      throw new OwnerRefusal("METRIC_VIEW_STATUS_INVALID", "ids: expected at least one metric id");
    if (status == null
        || !Set.of(MetricView.STATUS_PENDING_REVIEW, MetricView.STATUS_PUBLISHED, MetricView.STATUS_UNUSED).contains(status))
      throw new OwnerRefusal("METRIC_VIEW_STATUS_INVALID", "status: expected PENDING_REVIEW, PUBLISHED or UNUSED");
    List<StatusResult> results = new ArrayList<>();
    for (String id : new LinkedHashSet<>(ids)) {
      try {
        MetricView saved = new TransactionTemplate(transactionManager).execute(transaction -> {
          MetricView metric = queryById(id, domainId);
          if (metric == null) throw new OwnerRefusal("METRIC_VIEW_NOT_FOUND", langService.get(lang, "MetricView.notFound"));
          metric.setStatus(status);
          return persist(metric, WriteKind.SAVE, lang);
        });
        results.add(new StatusResult(id, saved, null, null));
      } catch (OwnerRefusal refusal) {
        results.add(new StatusResult(id, null, refusal, null));
      } catch (Exception error) {
        results.add(new StatusResult(id, null, null, failureMessage(error)));
      }
    }
    return results;
  }

  private static String failureMessage(Exception error) {
    String message = error.getMessage();
    if (message == null || message.isBlank()) return error.getClass().getName();
    return message;
  }

  @Override
  public List<MetricView> find(String question, String className, String domainId) {
    return metricViewDao.find(question, className, 10, 0, domainId).stream().map(row -> hydrate(row, domainId)).toList();
  }

  @Override
  public byte[] exportMetricViews(String domainId, String lang) throws Exception {
    return ZipBundleUtil.zip("metricViews.json", JSON.toJSONString(queryList(null, null, null, domainId), Feature.WriteMapNullValue).getBytes(StandardCharsets.UTF_8));
  }

  @Override
  public JSONObject importMetricViews(byte[] zipData, String lang) throws Exception {
    JSONArray array = JSON.parseArray(new String(ZipBundleUtil.unzipFirstJson(zipData), StandardCharsets.UTF_8));
    String domain = Objects.requireNonNull(SystemUtils.getCurUser().getDomainId(), "Current domain is required");
    JSONArray failures = new JSONArray();
    int successCount = 0;
    for (int i = 0; i < array.size(); i++) {
      JSONObject item = null;
      try {
        if (!(array.get(i) instanceof JSONObject)) throw new IllegalArgumentException("items[" + i + "]: expected a MetricView object");
        item = array.getJSONObject(i);
        if (item.containsKey("type")) throw new IllegalArgumentException("Legacy MetricView bundles require conversion before import");
        Function acceptedFunction = Function.fromAsset(item);
        MetricView metric = item.to(MetricView.class);
        metric.setFunction(acceptedFunction);
        metric.setDomainId(domain);
        new TransactionTemplate(transactionManager).execute(status -> persist(metric, WriteKind.IMPORT, lang));
        successCount++;
      } catch (Exception error) {
        failures.add(JSONObject.of("index", i, "id", item == null ? null : item.getString("id"), "message", error.getMessage()));
      }
    }
    return JSONObject.of("success", failures.isEmpty(), "successCount", successCount, "failureCount", failures.size(), "failures", failures);
  }

  @Override
	public MetricViewContent test(MetricView metricView, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception {
        return test(metricView,lang,user,permission,timeoutMinutes,ExecutionTarget.LIVE);
    }
    @Override
    public MetricViewContent test(MetricView metricView,String lang,User user,UserDataPermission permission,int timeoutMinutes,ExecutionTarget target) throws Exception {
        metricView = validateDraftDomain(metricView, user.getDomainId(),
            metricView.getId() == null ? null : queryById(metricView.getId(), user.getDomainId()), lang);
        if (metricView.isWorkflowPending()) {
            var result = executePending(metricView, null, new JSONObject(), lang, user, permission, target);
            return generateContent((JSONArray)result[0], (PythonExecuteResult)result[1], metricView.getName(), metricView, lang);
        }
		Object[] o = abcProgramService.execute(UUID.randomUUID().toString(), MetricViewBindings.executionFunction(metricView.getFunction(), subjectValues.resolveValues(MetricViewBindings.values(metricView.getFunction()), user)), user.getId(), permission, target.sandboxId(), lang, timeoutMinutes, user.getDomainId(), new ABCProgramService.ExecutionContext(null, null, target));
		MetricViewContent metricViewContent = generateContent((JSONArray)o[0], (PythonExecuteResult)o[1], metricView.getName(), metricView, lang);
		return metricViewContent;
	}

private MetricViewContent generateContent(JSONArray rows, PythonExecuteResult execution, String question, MetricView metricView, String lang) {
		int maxSize = 100;
		MetricViewContent metricViewContent = new MetricViewContent();
		Function function = metricView.getFunction();
		
		String md = "";
		md += "# " + function.getName() + "\n";
		md += question + "\n";
		Set<String> titles = new HashSet<String>();
		for (int i = 0; i < rows.size() && i < maxSize; i++) {
			JSONObject row = rows.getJSONObject(i);
			Set<String> keys = row.keySet();
			titles.addAll(keys);
		}
		for (String title : titles) {
			md += "| " + title + " ";
		}
		md += "|\n";
		for (int i = 0; i < titles.size(); i++) {
			md += "| --- ";
		}
		md += "|\n";
		for (int i = 0; i < rows.size() && i < maxSize; i++) {
			JSONObject row = rows.getJSONObject(i);
			for (String title : titles) {
				Object value = row.get(title);
				md += "| " + value + " ";
			}
			md += "|\n";
		}
		if (rows.size() > maxSize) {
			for (int i = 0; i < titles.size(); i++) {
				md += "| ... ";
			}
			md += "|\n";
			md += langService.get(lang, "QuestionCard.totalNum") + ": " + rows.size() + ", " + langService.get(lang, "QuestionCard.showNum") + maxSize + ", " + langService.get(lang, "QuestionCard.canGetByUrl") + ".\n";
		}
		JSONObject answerPayload = new JSONObject();
		answerPayload.put("answer", rows);
		execution.markCompleteness(answerPayload);
		if (answerPayload.containsKey(DslRowLimit.TRUNCATED)) {
			md += "\n> " + answerPayload.getString(DslRowLimit.TRUNCATION_HINT) + "\n";
		}
		metricViewContent.setMd(md);
		
		metricViewContent.setOriginQuestion(metricView.getOriginQuestion());
		metricViewContent.setOriginCheckResult(metricView.getOriginCheckResult());
		
		List<String> parameterInstanceDesc = new ArrayList<String>();
		for (Parameter parameter : function.getParameters()) {
			parameterInstanceDesc.add(langService.get(lang, "QuestionCard.originCondition") + "[" + parameter.getSample() + "], " + langService.get(lang, "QuestionCard.replaceTo") + ": " + parameter.getValue());
		}
		metricViewContent.setParameterInstanceDesc(parameterInstanceDesc);

		return metricViewContent;
	}

  @Override
  public Object[] execute(String id, String bindingId, JSONObject param, JSONObject parameterTexts, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception {
    return execute(id,bindingId,param,parameterTexts,lang,user,permission,timeoutMinutes,ExecutionTarget.LIVE);
  }
  @Override
  public Object[] execute(String id,String bindingId,JSONObject param,JSONObject parameterTexts,String lang,User user,UserDataPermission permission,int timeoutMinutes,ExecutionTarget target) throws Exception {
    MetricView metric = queryById(id, user.getDomainId());
    if (metric == null) throw new IllegalArgumentException("MetricView not found");
    JSONObject values = param == null ? new JSONObject() : new JSONObject(param);
    if (parameterTexts != null) {
      var definitions = metric.getFunction().getParameters().stream()
          .filter(parameter -> parameterTexts.containsKey(parameter.getName())).toList();
      if (definitions.size() != parameterTexts.size())
        throw new IllegalArgumentException("Parameters must match the metric definition exactly");
      var parsed = ParameterForms.interactive(
          definitions, ScheduleJson.JSON.valueToTree(parameterTexts),
          Map.of(), List.of(), lang);
      if (!parsed.errors().isEmpty())
        throw new IllegalArgumentException(parsed.errors().get(0).path("message").asText());
      values.putAll(parsed.values());
    }
    return testExecute(metric, bindingId, values, lang, user, permission, timeoutMinutes, target);
  }

  @Override
  public Object[] testExecute(MetricView metric, String bindingId, JSONObject param, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception {
    return testExecute(metric,bindingId,param,lang,user,permission,timeoutMinutes,ExecutionTarget.LIVE);
  }
  @Override
  public Object[] testExecute(MetricView metric,String bindingId,JSONObject param,String lang,User user,UserDataPermission permission,int timeoutMinutes,ExecutionTarget target) throws Exception {
    if (metric == null) throw new IllegalArgumentException("MetricView not found");
    MetricView stored = null;
    if (metric.getId() != null) {
      stored = queryById(metric.getId(), user.getDomainId());
      if (stored == null) throw new OwnerRefusal("METRIC_VIEW_NOT_FOUND", langService.get(lang, "MetricView.notFound"));
      if (!executable(stored, user))
        throw new OwnerRefusal("METRIC_VIEW_NOT_EXECUTABLE", "Executable read metric not found");
    } else if (!executable(metric, user)) {
      throw new OwnerRefusal("METRIC_VIEW_NOT_EXECUTABLE", "Executable read metric not found");
    }
    metric = validateDraftDomain(metric, user.getDomainId(), stored, lang);
    if (metric.isWorkflowPending()) return executePending(metric, bindingId, param, lang, user, permission, target);
    QueryPackage.prepareReadFunction(metric.getFunction(),
        (List<Map<String, Object>>) adminService.getJSONRule(user.getDomainId()).get("classDef"));
    validateBindings(metric.getFunction(), metric.getBindings(), false);
    JSONObject values = subjectValues.metricParameters(metric, bindingId, param, user);
    Function execution = MetricViewBindings.executionFunction(metric.getFunction(), values);
    return abcProgramService.execute(UUID.randomUUID().toString(), execution, user.getId(), permission, target.sandboxId(), lang, timeoutMinutes, user.getDomainId(), new ABCProgramService.ExecutionContext(null, null, target));
  }

  private Object[] executePending(MetricView metric, String bindingId, JSONObject params, String lang, User user,
                                  UserDataPermission permission, ExecutionTarget target) throws Exception {
    var result = pending.execute(UUID.randomUUID().toString(), metric, subjectValues.metricParameters(metric, bindingId, params, user),
        new QueryAccessService.Access(user, permission, null, null, null).withTarget(target), lang);
    return new Object[]{result.rows(), result.execution()};
  }

  private MetricView validateDraftDomain(MetricView metric, String domain, MetricView storedMetric, String lang) {
    if (metric.getId() != null) {
      if (storedMetric == null) throw new OwnerRefusal("METRIC_VIEW_NOT_FOUND", langService.get(lang, "MetricView.notFound"));
      if (storedMetric.isWorkflowPending()) return storedMetric;
      Set<String> ids = new HashSet<>();
      for (var binding : storedMetric.getBindings()) ids.add(binding.getId());
      if (metric.getBindings() != null) for (var binding : metric.getBindings())
        if (binding.getId() != null && !ids.contains(binding.getId()))
          throw new OwnerRefusal("METRIC_VIEW_BINDING_NOT_FOUND", "Metric binding not found");
    }
    if (metric.isWorkflowPending()) throw new IllegalArgumentException("Published workflow metric required");
    if (metric.getDomainId() != null && !domain.equals(metric.getDomainId()))
      throw new OwnerRefusal("METRIC_VIEW_NOT_FOUND", langService.get(lang, "MetricView.notFound"));
    Function function = Objects.requireNonNull(metric.getFunction(), "Function is required");
    if (!Function.OPERATION_READ.equals(function.getOperation()))
      throw new OwnerRefusal("METRIC_VIEW_FUNCTION_INVALID", "MetricView requires a read Function");
    if (function.getId() != null) {
      Function stored = functionDao.queryById(function.getId());
      if (stored == null || !domain.equals(stored.getDomainId()) || !Function.OPERATION_READ.equals(stored.getOperation()))
        throw new OwnerRefusal("METRIC_VIEW_FUNCTION_INVALID", "Read Function not found");
    }
    return metric;
  }
}

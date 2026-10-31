package io.ontomato.dataengine.service.impl;

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
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.MetricViewService;
import io.ontomato.dataengine.service.SessionCancelledException;
import io.ontomato.dataengine.service.agent.OntologyGenerationPrompts;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DBSchemaUtil;
import io.ontomato.dataengine.util.SystemUtils;
import io.ontomato.dataengine.util.ZipBundleUtil;
import jakarta.annotation.PostConstruct;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Slf4j
@Service
public class MetricViewServiceImpl implements MetricViewService {

  @Autowired private MetricViewDao metricViewDao;

  @Autowired private FunctionDao functionDao;

  @Autowired private BusinessConfigService businessConfigService;

  @Autowired private KnowledgeDao knowledgeDao;

  @Autowired private AdminService adminService;

  @Autowired private ABCProgramService abcProgramService;

  @Autowired private LangService langService;

  @Autowired private OntologyGenerationService generationService;

  @Autowired private PlatformTransactionManager transactionManager;

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
							if (!MetricView.ORIGIN_SYSTEM.equals(metricView.getOrigin())) {
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
      String code = envelope.getString("code");
      String name = envelope.getString("name");
      String logic = envelope.getString("logic");
      JSONObject sourceAnalysis = envelope.getJSONObject("sourceAnalysis");
      if (code == null || name == null || logic == null || sourceAnalysis == null) return null;
      io.ontomato.dataengine.service.QuerySubgraphContract.validate(sourceAnalysis);
      List<Parameter> parameters = new ArrayList<Parameter>();
      if (envelope.containsKey("parameterDefs")) {
        parameters =
            DBSchemaUtil.buildParameters(
                envelope.getJSONArray("parameterDefs").toList(Map.class), classDefs);
      }
      Function function = new Function();
      function.setOrigin(Function.ORIGIN_USER);
      function.setOperation(Function.OPERATION_READ);
      function.setDomainId(domainId);
      function.setName(name);
      function.setParameters(parameters);
      function.setCode(code);
      function.setLogic(logic);

      ReturnDef returnDef = new ReturnDef();
      returnDef.setIsVoid(false);
      List<String> classNames = sourceAnalysis.getJSONArray("nodes").stream().map(JSONObject::from)
          .filter(n -> "class".equals(n.getString("kind"))).map(n -> n.getString("className")).distinct().toList();
      returnDef.setSourceAnalysis(sourceAnalysis);
      returnDef.setClassNames(classNames);
      function.setReturnDef(returnDef);

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
    return new TransactionTemplate(transactionManager).execute(status -> persist(metric, false));
  }

  private MetricView persist(MetricView metric, boolean importing) {
    String domain = Objects.requireNonNull(metric.getDomainId(), "Current domain is required");
    MetricView previous = null;
    if (metric.getId() != null) {
      metricViewDao.lock(metric.getId(), domain);
      previous = queryById(metric.getId(), domain);
      if (previous == null && (!importing || metricViewDao.exists(metric.getId())))
        throw new IllegalArgumentException("MetricView not found");
      if (previous != null && MetricView.ORIGIN_SYSTEM.equals(previous.getOrigin()))
        throw new IllegalArgumentException("Cannot modify a system MetricView");
    }
    if (metric.getBindings() == null)
      metric.setBindings(previous == null ? new ArrayList<>() : previous.getBindings());
    if (!importing) {
      Set<String> owned = new HashSet<>();
      if (previous != null) for (var binding : previous.getBindings()) owned.add(binding.getId());
      for (var binding : metric.getBindings())
        if (binding.getId() != null && !owned.contains(binding.getId()))
          throw new IllegalArgumentException("Metric binding not found");
    }
    Function function = Objects.requireNonNull(metric.getFunction(), "Function is required");
    if (!Function.OPERATION_READ.equals(function.getOperation()))
      throw new IllegalArgumentException("MetricView requires a read Function");
    if (function.getId() != null) {
      Function stored = functionDao.queryById(function.getId());
      if (stored == null && !importing) throw new IllegalArgumentException("Function not found");
      if (stored != null && (!domain.equals(stored.getDomainId()) || !Function.OPERATION_READ.equals(stored.getOperation())))
        throw new IllegalArgumentException("Read Function not found");
      if (stored != null) {
        function.setOrigin(stored.getOrigin());
        function.setCreateTimestamp(stored.getCreateTimestamp());
      }
    }
    function.setDomainId(domain);
    if (function.getOrigin() == null) function.setOrigin(Function.ORIGIN_USER);
    MetricViewBindings.validate(function, metric.getBindings());
    List<MetricView> sharing = function.getId() == null ? List.of() : queryList(null, function.getId(), null, domain);
    for (MetricView other : sharing)
      if (!Objects.equals(other.getId(), metric.getId())) MetricViewBindings.validate(function, other.getBindings());
    metric.setOrigin(previous == null ? MetricView.ORIGIN_USER : previous.getOrigin());
    metric.setCreateTimestamp(previous == null ? null : previous.getCreateTimestamp());
    functionDao.save(function);
    metricViewDao.save(metric);
    // A shared definition's class projection follows the same edit as its bindings.
    for (MetricView other : sharing) {
      if (Objects.equals(other.getId(), metric.getId())) continue;
      other.setFunction(function);
      metricViewDao.save(other);
    }
    return metric;
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
        metric.getBindings().add(binding);
      }
      MetricViewBindings.validate(metric.getFunction(), metric.getBindings());
      return metricViewDao.save(metric);
    });
  }

  @Override
  public void delete(String id, String domainId, String lang) {
    MetricView metric = queryById(id, domainId);
    if (metric == null) throw new IllegalArgumentException("MetricView not found");
    if (MetricView.ORIGIN_SYSTEM.equals(metric.getOrigin()))
      throw new IllegalArgumentException("Cannot delete a system MetricView");
    metricViewDao.delete(id, domainId);
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
  public List<MetricView> queryForRetrieval(String domainId, String query, String cursor, List<String> classes, int limit) {
    return metricViewDao.queryForRetrieval(domainId, query, cursor, classes, limit).stream()
        .map(row -> hydrate(row, domainId)).toList();
  }

  @Override
  public MetricView queryById(String id, String domainId) {
    Objects.requireNonNull(domainId, "Current domain is required");
    Object[] row = metricViewDao.queryById(id, domainId);
    return row == null ? null : hydrate(row, domainId);
  }

  @Override
  public List<MetricView> queryList(String status, String functionId, String className, String domainId) {
    Objects.requireNonNull(domainId, "Current domain is required");
    return metricViewDao.queryList(status, functionId, className, domainId).stream().map(row -> hydrate(row, domainId)).toList();
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
      JSONObject item = array.getJSONObject(i);
      try {
        if (item.containsKey("type")) throw new IllegalArgumentException("Legacy MetricView bundles require conversion before import");
        MetricView metric = item.to(MetricView.class);
        metric.setDomainId(domain);
        new TransactionTemplate(transactionManager).execute(status -> persist(metric, true));
        successCount++;
      } catch (Exception error) {
        failures.add(JSONObject.of("index", i, "id", item.getString("id"), "message", error.getMessage()));
      }
    }
    return JSONObject.of("success", failures.isEmpty(), "successCount", successCount, "failureCount", failures.size(), "failures", failures);
  }

  @Override
	public MetricViewContent test(MetricView metricView, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception {
            validateDraftDomain(metricView, user.getDomainId());
		Object[] o = abcProgramService.execute(UUID.randomUUID().toString(), MetricViewBindings.executionFunction(metricView.getFunction(), MetricViewBindings.values(metricView.getFunction())), user.getId(), permission, null, lang, timeoutMinutes, user.getDomainId());
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
  public Object[] execute(String id, String bindingId, JSONObject param, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception {
    return testExecute(queryById(id, user.getDomainId()), bindingId, param, lang, user, permission, timeoutMinutes);
  }

  @Override
  public Object[] testExecute(MetricView metric, String bindingId, JSONObject param, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception {
    if (metric == null) throw new IllegalArgumentException("MetricView not found");
    validateDraftDomain(metric, user.getDomainId());
    if (!MetricView.STATUS_PUBLISHED.equals(metric.getStatus()))
      throw new IllegalArgumentException("MetricView is not published");
    JSONObject values = MetricViewBindings.resolve(metric, bindingId, param);
    Function execution = MetricViewBindings.executionFunction(metric.getFunction(), values);
    return abcProgramService.execute(UUID.randomUUID().toString(), execution, user.getId(), permission, null, lang, timeoutMinutes, user.getDomainId());
  }

  private void validateDraftDomain(MetricView metric, String domain) {
    if (metric.getId() != null) {
      MetricView stored = queryById(metric.getId(), domain);
      if (stored == null) throw new IllegalArgumentException("MetricView not found");
      Set<String> ids = new HashSet<>();
      for (var binding : stored.getBindings()) ids.add(binding.getId());
      if (metric.getBindings() != null) for (var binding : metric.getBindings())
        if (binding.getId() != null && !ids.contains(binding.getId()))
          throw new IllegalArgumentException("Metric binding not found");
    }
    if (metric.getDomainId() != null && !domain.equals(metric.getDomainId()))
      throw new IllegalArgumentException("MetricView not found");
    Function function = Objects.requireNonNull(metric.getFunction(), "Function is required");
    if (!Function.OPERATION_READ.equals(function.getOperation()))
      throw new IllegalArgumentException("MetricView requires a read Function");
    if (function.getId() != null) {
      Function stored = functionDao.queryById(function.getId());
      if (stored == null || !domain.equals(stored.getDomainId()) || !Function.OPERATION_READ.equals(stored.getOperation()))
        throw new IllegalArgumentException("Read Function not found");
    }
  }
}

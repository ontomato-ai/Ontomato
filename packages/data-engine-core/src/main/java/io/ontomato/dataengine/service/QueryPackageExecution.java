package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import java.util.*;

/** Shared package execution for retrieval, Functions, generation tests and dashboards. */
public final class QueryPackageExecution {
  private QueryPackageExecution() {}
  public record Result(JSONArray rows, JSONObject analysis, JSONObject parameters, PythonExecuteResult execution) {}

  @SuppressWarnings("unchecked")
  public static Result execute(String id, JSONObject bundle, JSONObject parameters, JSONObject labels,
      QueryAccessService.Access access, String lang, int minutes, OntologyQueryService ontology,
      PythonExecuteService python) throws Exception {
    return execute(id, bundle, parameters, labels, access, lang, minutes, ontology, python, null);
  }

  @SuppressWarnings("unchecked")
  static Result execute(String id, JSONObject bundle, JSONObject parameters, JSONObject labels,
      QueryAccessService.Access access, String lang, int minutes, OntologyQueryService ontology,
      PythonExecuteService python, JSONObject workflowPredicate) throws Exception {
    QueryPackage.validate(bundle);
    var values = QueryPackage.parameters(bundle, parameters);
    var definitions = (List<Map<String, Object>>) ontology.rule(access).get("classDef");
    var analysis = QueryPackage.analysis(bundle, values, labels, definitions);
    QueryPermissions.authorizeInputs(analysis, access.permission(), definitions);
    var entry = bundle.getJSONObject("manifest").getJSONObject("entry");
    JSONArray rows;
    PythonExecuteResult execution;
    if ("dsl".equals(entry.getString("kind"))) {
      var query = QueryPackage.query(bundle, entry.getString("query"), values);
      var result = JSONObject.from(workflowPredicate == null ? ontology.execute(query, access)
          : ontology.executeGoverned(query, access, workflowPredicate));
      if (result.getJSONArray("data").size() != 1) throw new IllegalArgumentException("One output table is required");
      var datum = result.getJSONArray("data").getJSONObject(0);
      rows = datum.getJSONArray("answer");
      execution = new PythonExecuteResult();
      execution.setResult(JSON.toJSONString(JSONObject.of("answer", rows), JSONWriter.Feature.WriteMapNullValue));
      execution.setPartialQuery(OntologyQueryService.partial(datum));
    } else {
      var authority = PythonAuthority.read(access.user().getId(), access.user().getDomainId())
          .withClasses(QueryAccessService.classScope(access.permission(), access.classNames()))
          .withTarget(access.target()).forExecution(id).withPackage(bundle, values);
      if (access.grant() != null) authority = authority.withParent(new PythonAuthority.ParentGrant(
          access.credential(), access.grant().getString("runId"), access.grant().getLongValue("expiresAt")));
      var inputs = new LinkedHashMap<String, String>();
      QueryPackage.files(bundle).forEach((path, content) -> inputs.put("package/" + path, content));
      execution = python.execute(id, QueryPackage.launcher(bundle), minutes, lang, authority, values, inputs);
      rows = PythonRows.parse(execution.getResult(), execution.getError());
    }
    return new Result(QueryPermissions.mask(rows, analysis, access.permission()), analysis, values, execution);
  }
}

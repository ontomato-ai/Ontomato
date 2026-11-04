package io.ontomato.dataengine.service.impl;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.abcHarness.*;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

@Service
public class ABCProgramServiceImpl implements ABCProgramService {
  @Autowired private PythonExecuteService pythonExecuteService;
  @Autowired @Lazy private OntologyQueryService ontology;

  @Override
  public Object[] execute(String id, ABCHarnessProgram program, String user, UserDataPermission permission,
      String lang, int timeout, String domain) throws Exception {
    var graph = sourceAnalysis(program.getSourceAnalysis(), program.getOutKeyRefs());
    if (program.getQueryPackage() != null)
      return executePackage(id, program.getQueryPackage(), program.getParameterValues(), graph, user, permission, lang, timeout, domain);
    var result = pythonExecuteService.execute(id, program.getCode(), timeout, lang,
        PythonAuthority.read(user, domain), program.getParameterValues() == null ? new JSONObject() : program.getParameterValues(), Map.of());
    return new Object[]{authorized(result, graph, permission), result};
  }

  @Override
  public Object[] execute(String id, ABCHarnessDashboard dashboard, String user, UserDataPermission permission,
      String lang, int timeout, String domain) throws Exception {
    var graph = sourceAnalysis(dashboard.getSourceAnalysis(), dashboard.getOutKeyRefs());
    var parameters = dashboard.getParameterValues() == null ? new JSONObject() : QueryPackage.copy(dashboard.getParameterValues());
    if (dashboard.getParameters() != null)
      for (var parameter : dashboard.getParameters()) parameters.put(parameter.getKey(), parameter.getValue());
    if (dashboard.getQueryPackage() != null)
      return executePackage(id, dashboard.getQueryPackage(), parameters, graph, user, permission, lang, timeout, domain);
    var result = pythonExecuteService.execute(id, dashboard.getCode(), timeout, lang,
        PythonAuthority.read(user, domain), parameters, Map.of());
    return new Object[]{authorized(result, graph, permission), result};
  }

  @Override
  public Object[] execute(String id, Function function, String user, UserDataPermission permission,
      String sandbox, String lang, int timeout, String domain) throws Exception {
    if (!domain.equals(function.getDomainId())) throw new IllegalArgumentException("Function is outside the current domain");
    var parameters = MetricViewBindings.values(function);
    boolean read = Function.OPERATION_READ.equals(function.getOperation());
    if (!read && !Function.OPERATION_WRITE.equals(function.getOperation())) throw new IllegalArgumentException("Unknown Function operation");
    if (read && function.getReturnDef() == null) throw new IllegalArgumentException("Stored program has no source declaration");
    var graph = read ? sourceAnalysis(function.getReturnDef().getSourceAnalysis(), function.getReturnDef().getOutKeyRefs()) : null;
    if (read && function.getQueryPackage() != null)
      return executePackage(id, function.getQueryPackage(), parameters, graph, user, permission, lang, timeout, domain);
    var result = pythonExecuteService.execute(id, function.getCode(), timeout, lang,
        read ? PythonAuthority.read(user, domain) : PythonAuthority.write(user, domain, sandbox)
            .withClasses(function.getReturnDef() == null ? null : function.getReturnDef().getClassNames()), parameters, Map.of());
    return new Object[]{read ? authorized(result, graph, permission) : null, result};
  }

  private Object[] executePackage(String id, JSONObject bundle, JSONObject values, JSONObject graph, String user,
      UserDataPermission permission, String lang, int timeout, String domain) throws Exception {
    var access = new QueryAccessService.Access(new QueryAccessService.GrantUser(user, domain), permission, null, null, null);
    var result = QueryPackageExecution.execute(id, bundle, values, QueryPackage.labels(graph), access,
        lang, timeout, ontology, pythonExecuteService);
    return new Object[]{result.rows(), result.execution()};
  }

  private JSONObject sourceAnalysis(JSONObject graph, List<ABCHarnessProgramOutKeyRef> legacy) {
    return graph == null ? QuerySourceAnalysis.fromStoredSources(legacy) : QuerySubgraphContract.validate(graph);
  }
  private JSONArray authorized(PythonExecuteResult result, JSONObject graph, UserDataPermission permission) throws Exception {
    return QueryPermissions.mask(PythonRows.parse(result.getResult(), result.getError()), graph, permission);
  }
  @Override
  public JSONArray parsePythonReturn(String output, String error) throws Exception { return PythonRows.parse(output, error); }
  @Override
  public JSONArray dealPythonReturn(String output, String error, List<ABCHarnessProgramOutKeyRef> refs,
      UserDataPermission permission) throws Exception {
    return QueryPermissions.mask(PythonRows.parse(output, error), QuerySourceAnalysis.fromStoredSources(refs), permission);
  }
}

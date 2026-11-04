package io.ontomato.dataengine.service.impl;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessDashboard;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessDashboardParameter;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.service.ABCProgramDashboardService;
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.agent.OntologyGenerationPrompts;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DBSchemaUtil;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class ABCProgramDashboardServiceImpl implements ABCProgramDashboardService {

  @Autowired private BusinessConfigService businessConfigService;

  @Autowired private AdminService adminService;

  @Autowired private ABCProgramService abcProgramService;

  @Autowired private LangService langService;

  @Autowired private OntologyGenerationService generationService;

  private List<ABCHarnessDashboardParameter> packageParameters(JSONObject bundle, JSONObject supplied) {
    var values = io.ontomato.dataengine.service.QueryPackage.parameters(bundle, supplied);
    var parameters = new ArrayList<ABCHarnessDashboardParameter>();
    for (var definition : io.ontomato.dataengine.service.QueryPackage.definitions(bundle)) {
      var parameter = new ABCHarnessDashboardParameter();
      parameter.setKey(definition.getName());
      parameter.setName(definition.getName());
      parameter.setType(definition.getType().replaceFirst("^TYPE_", ""));
      parameter.setValue(values.get(definition.getName()));
      parameters.add(parameter);
    }
    return parameters;
  }

  @Override
  public ABCHarnessDashboard fromProgram(
      ABCHarnessProgram program, boolean needParameter, String lang, String domainId)
      throws Exception {
    if (needParameter) {
      // Call the dashboard maker
      String sessionId = UUID.randomUUID().toString();

      Map<String, Object> jsonRule = generationService.authorizedRule(adminService.getJSONRule(domainId), domainId);
      var promptProgram = program;
      if (program.getQueryPackage() != null) {
        promptProgram = new ABCHarnessProgram();
        promptProgram.setQuestion(program.getQuestion());
        promptProgram.setCode(io.ontomato.dataengine.service.QueryPackage.reviewCode(program.getQueryPackage(),
            io.ontomato.dataengine.service.QueryPackage.parameters(program.getQueryPackage(), program.getParameterValues())));
      }
      String userMessage =
          OntologyGenerationPrompts.getAbcProgramDashboardMakerUserMessage(
              promptProgram, lang, langService, jsonRule);
      try (var generation =
          generationService.generate("dashboard", sessionId, userMessage, lang, domainId)) {
        JSONObject envelope = generation.result();
        JSONObject bundle = envelope.getJSONObject("queryPackage");
        String title = envelope.getString("title");
        if (bundle == null || title == null) return null;
        var function = new io.ontomato.dataengine.bean.function.Function();
        function.setOperation(io.ontomato.dataengine.bean.function.Function.OPERATION_READ);
        function.setQueryPackage(bundle);
        var returns = new io.ontomato.dataengine.bean.function.ReturnDef();
        returns.setColumnLabels(envelope.getJSONObject("columnLabels"));
        function.setReturnDef(returns);
        io.ontomato.dataengine.service.QueryPackage.prepareReadFunction(function,
            (List<Map<String, Object>>) jsonRule.get("classDef"));
        ABCHarnessDashboard dashboard = new ABCHarnessDashboard();
        dashboard.setTitle(title.trim());
        dashboard.setQueryPackage(bundle);
        dashboard.setSourceAnalysis(returns.getSourceAnalysis());
        dashboard.setParameters(packageParameters(bundle, null));

        var access = generationService.executionAccess(domainId);
        // Test
        int timeoutMinutes = 10;
        JSONArray dashboardResult =
            (JSONArray)
                abcProgramService
                    .execute(
                        UUID.randomUUID().toString(),
                        dashboard,
                        access.user().getId(),
                        access.permission(),
                        lang,
                        timeoutMinutes,
                        domainId)[0];
        JSONArray originResult =
            (JSONArray)
                abcProgramService
                    .execute(
                        UUID.randomUUID().toString(),
                        program,
                        access.user().getId(),
                        access.permission(),
                        lang,
                        timeoutMinutes,
                        domainId)[0];
        if (dashboardResult
            .toString(Feature.MapSortField)
            .equals(originResult.toString(Feature.MapSortField))) {
          return generation.settle(() -> dashboard);
        }
        return null;
      }
    } else {
      ABCHarnessDashboard dashboard = new ABCHarnessDashboard();
      dashboard.setTitle(program.getQuestion());
      dashboard.setQueryPackage(program.getQueryPackage());
      dashboard.setParameterValues(program.getParameterValues());
      dashboard.setCode(program.getQueryPackage() == null ? program.getCode() : null);
      dashboard.setSourceAnalysis(program.getSourceAnalysis() != null ? program.getSourceAnalysis() : io.ontomato.dataengine.service.QuerySourceAnalysis.fromStoredSources(program.getOutKeyRefs()));
      dashboard.setParameters(program.getQueryPackage() == null ? new ArrayList<>()
          : packageParameters(program.getQueryPackage(), program.getParameterValues()));
      return dashboard;
    }
  }
}

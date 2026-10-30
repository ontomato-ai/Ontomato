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

  @Override
  public ABCHarnessDashboard fromProgram(
      ABCHarnessProgram program, boolean needParameter, String lang, String domainId)
      throws Exception {
    if (needParameter) {
      // Call the dashboard maker
      String sessionId = UUID.randomUUID().toString();

      Map<String, Object> jsonRule = generationService.authorizedRule(adminService.getJSONRule(domainId), domainId);
      String userMessage =
          OntologyGenerationPrompts.getAbcProgramDashboardMakerUserMessage(
              program, lang, langService, jsonRule);
      try (var generation =
          generationService.generate("dashboard", sessionId, userMessage, lang, domainId)) {
        JSONObject envelope = generation.result();
        String code = envelope.getString("code");
        String title = envelope.getString("title");
        JSONArray defsArray = envelope.getJSONArray("parameterDefs");
        if (code == null || title == null || defsArray == null) {
          return null;
        }
        List<ABCHarnessDashboardParameter> parameters =
            JSONArray.parseArray(defsArray.toJSONString(), ABCHarnessDashboardParameter.class);
        List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
        for (ABCHarnessDashboardParameter parameter : parameters) {
          parameter.setClassName(
              DBSchemaUtil.normalizeClassName(parameter.getClassName(), classDefs));
        }
        ABCHarnessDashboard dashboard = new ABCHarnessDashboard();
        dashboard.setTitle(title.trim());
        dashboard.setCode(code);
        dashboard.setSourceAnalysis(io.ontomato.dataengine.service.QuerySubgraphContract.validate(envelope.getJSONObject("sourceAnalysis")));
        dashboard.setParameters(parameters);

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
      dashboard.setCode(program.getCode());
      dashboard.setSourceAnalysis(program.getSourceAnalysis() != null ? program.getSourceAnalysis() : io.ontomato.dataengine.service.QuerySourceAnalysis.fromStoredSources(program.getOutKeyRefs()));
      dashboard.setParameters(new ArrayList<ABCHarnessDashboardParameter>());
      return dashboard;
    }
  }
}

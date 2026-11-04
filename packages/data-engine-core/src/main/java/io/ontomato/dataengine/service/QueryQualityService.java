package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.bean.abcHarness.*;
import io.ontomato.dataengine.core.bean.User;
import org.springframework.stereotype.Service;

/** The existing asynchronous quality operation shared by HTTP and ontology retrieval. */
@Service
public class QueryQualityService {
  private final QueryJobService jobs;
  private final CheckServiceV2 checks;

  public QueryQualityService(QueryJobService jobs, CheckServiceV2 checks) {
    this.jobs = jobs;
    this.checks = checks;
  }

  public Object start(JSONObject body, User user, String lang) {
    return start(body, user, lang, true);
  }

  public Object start(
      JSONObject body, User user, String lang, boolean generateCandidates) {
    String id = body.getString("id");
    return jobs.start(
        id,
        user,
        "quality",
        body,
        sessionId -> {
          ABCHarnessCheck check = new ABCHarnessCheck();
          check.setSessionId(sessionId);
          check.setOriginQuestion(body.getString("question"));
          check.setLang(lang);
          check.setCreateTimestamp(System.currentTimeMillis());
          check.setFinished(false);
          var programs = body.getJSONArray("programs").toJavaList(ABCHarnessProgram.class);
          JSONArray recipes = body.getJSONArray("recipes");
          for (int i = 0; i < programs.size(); i++) {
            JSONObject recipe =
                recipes == null || i >= recipes.size() ? null : recipes.getJSONObject(i);
            // Describe the DSL code as executed, but without the natural-language problem field.
            if (recipe != null && "dsl".equals(recipe.getString("kind")))
              programs
                  .get(i)
                  .setCode(
                      io.ontomato.dataengine.util.DslToPythonCodeUtil.generateForQuality(
                          recipe.getJSONObject("dsl")));
          }
          checks.saveCheckTask(check);
          checks.check(
              check,
              programs,
              recipes,
              body.getList("classNames", String.class),
              user.getDomainId(),
              generateCandidates);
          return check;
        });
  }
}

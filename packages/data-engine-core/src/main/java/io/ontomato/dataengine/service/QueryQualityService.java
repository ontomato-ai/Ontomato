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
          for (int i = 0; i < programs.size(); i++)
            if (programs.get(i).getCode() == null
                && recipes != null
                && "dsl".equals(recipes.getJSONObject(i).getString("kind")))
              programs
                  .get(i)
                  .setCode(
                      io.ontomato.dataengine.util.DslToPythonCodeUtil.generate(
                          recipes.getJSONObject(i).getJSONObject("dsl"), ""));
          checks.saveCheckTask(check);
          checks.check(
              check, programs, body.getList("classNames", String.class), user.getDomainId());
          return check;
        });
  }
}

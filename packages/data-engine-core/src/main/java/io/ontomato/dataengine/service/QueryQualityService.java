package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.bean.abcHarness.*;
import io.ontomato.dataengine.core.bean.User;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/** Asynchronous quality with a separate candidate job; the quality result never waits for it. */
@Slf4j
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
              check, programs, body.getList("classNames", String.class), user.getDomainId());
          // The quality job returns the settled conclusion before the candidate job produces
          // anything; the candidate job keeps its own status and failure.
          if (generateCandidates
              && programs != null
              && check.getScore() != null
              && check.getScore() >= 60)
            startCandidateJob(
                id, user, check, programs, recipes, body.getList("classNames", String.class));
          return check;
        });
  }

  private void startCandidateJob(
      String qualityId,
      User user,
      ABCHarnessCheck check,
      List<ABCHarnessProgram> programs,
      JSONArray recipes,
      List<String> classNames) {
    String candidateId =
        UUID.nameUUIDFromBytes((qualityId + ":candidate").getBytes(StandardCharsets.UTF_8))
            .toString();
    JSONObject input =
        JSONObject.of(
            "checkSessionId", check.getSessionId(),
            "lang", check.getLang(),
            "score", check.getScore(),
            "conclusion", check.getConclusion(),
            "fittedQuestion", check.getFittedQuestion(),
            "programs", JSONArray.parseArray(JSON.toJSONString(programs)),
            "recipes", recipes,
            "classNames", classNames,
            "domainId", user.getDomainId());
    try {
      jobs.start(
          candidateId,
          user,
          "candidate",
          input,
          session -> {
            ABCHarnessCheck candidateCheck = new ABCHarnessCheck();
            candidateCheck.setSessionId(input.getString("checkSessionId"));
            candidateCheck.setLang(input.getString("lang"));
            candidateCheck.setScore(input.getDouble("score"));
            candidateCheck.setConclusion(input.getString("conclusion"));
            candidateCheck.setFittedQuestion(input.getString("fittedQuestion"));
            checks.generateCandidates(
                candidateCheck,
                input.getJSONArray("programs").toJavaList(ABCHarnessProgram.class),
                input.getJSONArray("recipes"),
                input.getString("domainId"));
            return null;
          });
    } catch (Exception failure) {
      log.warn(
          "Candidate job admission failed for quality check {}: {}",
          check.getSessionId(),
          failure.getMessage(),
          failure);
    }
  }
}

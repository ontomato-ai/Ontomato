package io.ontomato.dataengine.service.impl;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessCheck;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramDescription;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.OriginCheckResult;
import io.ontomato.dataengine.dao.CheckDaoV2;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.CheckServiceV2;
import io.ontomato.dataengine.service.FunctionService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.MetricViewService;
import io.ontomato.dataengine.service.SessionCancelledException;
import io.ontomato.dataengine.service.agent.OntologyGenerationPrompts;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
import jakarta.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Slf4j
@Service
public class CheckServiceV2Impl implements CheckServiceV2 {

  @Autowired private BusinessConfigService businessConfigService;

  @Autowired private AdminService adminService;

  @Autowired private FunctionService functionService;

  @Autowired private MetricViewService metricViewService;

  @Autowired private LangService langService;

  @Autowired private OntologyGenerationService generationService;
  @Autowired private io.ontomato.dataengine.service.QueryJobService jobs;

  @Autowired private CheckDaoV2 checkDaoV2;

  @Autowired private KnowledgeDao knowledgeDao;

  @PostConstruct
	public void initService() {
		// Periodically delete quality check tasks from one hour ago
		new Thread(new Runnable() {
			@Override
			public void run() {
				while (true) {
					try {
						List<ABCHarnessCheck> tasks = checkDaoV2.queryList();
						for (ABCHarnessCheck task : tasks) {
							if (task.getCreateTimestamp() < System.currentTimeMillis() - 60 * 60 * 1000L) {
								checkDaoV2.delete(task.getSessionId());
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
  public void saveCheckTask(ABCHarnessCheck check) {
    jobs.settle(
        () -> {
          checkDaoV2.save(check);
          return null;
        });
  }

  @Override
  public void check(
      ABCHarnessCheck check,
      List<ABCHarnessProgram> programs,
      List<String> classNames,
      String domainId) {
    try {
      // Call the quality checker
      List<ABCHarnessProgramDescription> programDescriptions =
          new ArrayList<ABCHarnessProgramDescription>();
      if (programs != null) {
        for (int i = 0; i < programs.size(); i++) {
          ABCHarnessProgram program = programs.get(i);
          ABCHarnessProgramDescription programDescription =
              describeProgram(
                  check.getSessionId(),
                  i,
                  check.getOriginQuestion(),
                  program,
                  classNames,
                  check.getLang(),
                  domainId);
          programDescriptions.add(programDescription);
        }
      }
      check.setProgramDescriptions(programDescriptions);
      check(check, domainId);

      // Create a metric card for scores above 60
      if (check.getScore() >= 60) {
        if (programs != null) {
          for (int i = 0; i < programs.size(); i++) {
            ABCHarnessProgram program = programs.get(i);
            // function-metricView
            Function function =
                functionService.generateFromABCProgram(
                    program.getQuestion(),
                    program,
                    check.getLang(),
                    domainId,
                    BackendSessionEntrance.derive(check.getSessionId(), "harness-program-" + i));
            if (function != null) {
              Function candidate = function;
              function = jobs.settle(() -> functionService.save(candidate, check.getLang()));
              MetricView metricView = metricViewService.generateFromFunction(function);
              metricView.setType(MetricView.TYPE_GENERAL);
              Set<String> matchQuestions = new HashSet<String>();
              matchQuestions.add(program.getQuestion());
              metricView.setMatchQuestions(matchQuestions);
              OriginCheckResult originCheckResult = new OriginCheckResult();
              originCheckResult.setScore(check.getScore());
              originCheckResult.setConclusion(check.getConclusion());
              originCheckResult.setFittedQuestion(check.getFittedQuestion());
              metricView.setOriginCheckResult(originCheckResult);
              metricView.setOriginQuestion(program.getQuestion());
              jobs.settle(() -> metricViewService.save(metricView, check.getLang()));
              // Convert to a dedicated metricView
              Function staticFunction =
                  functionService.generateStaticFromGeneral(
                      program.getQuestion(),
                      function.getParameters(),
                      function,
                      check.getLang(),
                      BackendSessionEntrance.derive(check.getSessionId(), "harness-static-" + i));
              if (staticFunction != null) {
                Function staticCandidate = staticFunction;
                staticFunction =
                    jobs.settle(() -> functionService.save(staticCandidate, check.getLang()));
                MetricView staticMetricView =
                    metricViewService.generateFromFunction(staticFunction);
                staticMetricView.setType(MetricView.TYPE_STATIC);
                staticMetricView.setMatchQuestions(matchQuestions);
                staticMetricView.setOriginCheckResult(metricView.getOriginCheckResult());
                staticMetricView.setOriginQuestion(metricView.getOriginQuestion());
                jobs.settle(() -> metricViewService.save(staticMetricView, check.getLang()));
              }
            }
          }
        }
      }
    } catch (Exception e) {
      if (SessionCancelledException.findCancelled(e) != null) {
        log.info("check cancelled: " + check.getSessionId());
        throw SessionCancelledException.findCancelled(e);
      }
      throw new IllegalStateException("Quality check failed", e);
    }
  }

  private ABCHarnessProgramDescription describeProgram(
      String sessionId,
      int index,
      String originQuestion,
      ABCHarnessProgram program,
      List<String> classNames,
      String lang,
      String domainId) {

    Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
    String userMessage =
        OntologyGenerationPrompts.getABCProgramDescriberUserMessage(
            program, lang, langService, classNames, jsonRule);
    try (var generation =
        generationService.generate(
            "describe",
            BackendSessionEntrance.derive(sessionId, "program-describer-" + index),
            userMessage,
            lang,
            domainId)) {
      JSONObject result = generation.result();
      String logic = result.getString("meaning"), summary = result.getString("summary");
      if (logic == null || summary == null)
        throw new IllegalArgumentException("Invalid program description");

      ABCHarnessProgramDescription description = new ABCHarnessProgramDescription();
      description.setCode(program.getCode());
      description.setMeaning(logic);
      description.setSummary(summary);
      return generation.settle(() -> description);
    }
  }

  private void check(ABCHarnessCheck check, String domainId) {

    String userMessage =
        OntologyGenerationPrompts.getQuestionCheckerV2UserMessage(
            check.getSessionId(),
            check.getOriginQuestion(),
            check.getProgramDescriptions(),
            knowledgeDao,
            businessConfigService,
            check.getLang(),
            langService,
            domainId);
    try (var generation =
        generationService.generate(
            "quality",
            BackendSessionEntrance.derive(check.getSessionId(), "question-checker"),
            userMessage,
            check.getLang(),
            domainId)) {
      JSONObject result = generation.result();
      String conclusion = result.getString("conclusion"),
          fitted = result.getString("fittedQuestion");
      Double score = result.getDouble("score");
      if (conclusion == null || fitted == null || score == null || !Double.isFinite(score))
        throw new IllegalArgumentException("Invalid quality result");
      generation.settle(
          () -> {
            check.setConclusion(conclusion);
            check.setScore(score);
            check.setFittedQuestion(fitted);
            check.setFinished(true);
            jobs.settle(
                () -> {
                  checkDaoV2.save(check);
                  return null;
                });
            return null;
          });
    }
  }

  @Override
	public ABCHarnessCheck queryBySessionId(String sessionId) {
		ABCHarnessCheck check = checkDaoV2.queryBySessionId(sessionId);
		return check;
	}
}

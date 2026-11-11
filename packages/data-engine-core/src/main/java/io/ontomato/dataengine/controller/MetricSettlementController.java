package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.MetricSettlementService;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** The built-in workbench adopts a dataset only under its current user's authority. */
@RestController
public class MetricSettlementController {
  private final WorkbenchServiceAuthentication workbench;
  private final QueryAccessService authorization;
  private final MetricSettlementService settlement;
  private final BackendSessionEntrance sessions;

  public MetricSettlementController(WorkbenchServiceAuthentication workbench, QueryAccessService authorization,
      MetricSettlementService settlement, BackendSessionEntrance sessions) {
    this.workbench = workbench;
    this.authorization = authorization;
    this.settlement = settlement;
    this.sessions = sessions;
  }

  @PostMapping("/ontology/ai/metrics/settle-from-dataset")
  public Object settle(@RequestBody JSONObject body,
      @RequestHeader(value = "Accept-Language", defaultValue = "en") String lang, HttpServletRequest request) {
    workbench.authenticate(request);
    var access = authorization.access(request);
    if (access.grant() != null)
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Settlement requires the end user credential");
    String session = sessions.beginNewSession(body);
    try {
      return OntologyGenerationService.asOwner(access.user(), () -> settlement.settle(session, body,
          access.user(), lang, true, null, work -> work.run()));
    } finally {
      sessions.endSession(session);
    }
  }
}

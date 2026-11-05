package io.ontomato.dataengine.schedules;

import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.config.ServiceConst;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
class FunctionTarget {
  private final FunctionDao functions;
  private final ABCProgramService programs;
  private final BusinessConfigService configs;

  Function require(String domain, String id) {
    var function = functions.queryById(id);
    if (function == null
        || !domain.equals(function.getDomainId())
        || !Function.OPERATION_WRITE.equals(function.getOperation())
        || function.getParameters() == null
        || !function.getParameters().isEmpty())
      throw TaskDefinition.bad("Expected a zero-parameter write function in the current domain");
    return function;
  }

  int timeout(String domain) {
    return configs.get(domain).getReportCardPythonTimeout();
  }

  PythonExecuteResult execute(TaskStore.Task t, TaskStore.Run run, int timeout) throws Exception {
    var function = require(t.domain(), run.target().get("functionId").asText());
    // Preserve the domain write task's existing execution identity and permission object.
    var output =
        programs.execute(
            t.id().toString(),
            function,
            null,
            new UserDataPermission(),
            ServiceConst.NOT_SANDBOX,
            "en",
            timeout,
            t.domain());
    return (PythonExecuteResult) output[1];
  }
}

package io.ontomato.dataengine.panelreads;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.OntologyQueryService;
import io.ontomato.dataengine.service.QueryAccessService.Access;
import io.ontomato.dataengine.service.QueryOutputService;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@Configuration(proxyBeanMethods = false)
class WorkbenchMetricResult {
    @Bean
    WorkbenchPanelRead.Query workbenchMetricResultRead(OntologyQueryService ontology, QueryOutputService outputs) {
        return WorkbenchPanelRead.Query.callerScoped("platform:MetricView", "result", WorkbenchPanelRead.QueryExecution.REQUEST_THREAD,
            (access, call, language) -> execute(ontology, outputs, access, call, language));
    }

    private static JSONObject execute(OntologyQueryService ontology, QueryOutputService outputs,
                                      Access access, Map<String, Object> call, String language) throws Exception {
        if (!(call.get("primaryKey") instanceof String id) || id.isBlank()
                || !(call.get("parameters") instanceof Map<?, ?> parameters))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A metric id and parameters object are required");
        if (access.expiresAt() != null && access.expiresAt() <= System.currentTimeMillis())
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "The user credential expired");
        var description = ontology.describeMetric(id, access);
        var output = outputs.executeMetric(JSONObject.of("id", id, "revision", description.getString("revision"),
            "parameters", JSONObject.from(parameters)), access, language);
        output.put("sourceObjectTypes", description.getJSONArray("sourceObjectTypes"));
        return output;
    }
}

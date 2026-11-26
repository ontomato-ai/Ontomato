package io.ontomato.dataengine.panelreads;

import static io.ontomato.dataengine.panelreads.WorkbenchPanelRead.QueryExecution.METADATA;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.MetricParameterForms;
import io.ontomato.dataengine.service.OntologyQueryService;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.server.ResponseStatusException;

@Configuration(proxyBeanMethods = false)
class WorkbenchMetricMetadata {
    @Bean
    WorkbenchPanelRead.Query workbenchMetricParameterForm(MetricParameterForms forms) {
        return WorkbenchPanelRead.Query.callerScoped("platform:MetricView", "parameterForm", METADATA, (access, call, language) -> {
            String id = metricId(call);
            if (!(call.get("parameters") instanceof Map<?, ?> parameters))
                throw new IllegalArgumentException("Metric parameters must be an object");
            // Caller admission protects the read; the parameter form retains the complete metric definition.
            return forms.form(id, JSONObject.from(parameters), access, language);
        });
    }

    @Bean
    WorkbenchPanelRead.Query workbenchMetricDescription(OntologyQueryService ontology) {
        return WorkbenchPanelRead.Query.callerScoped("platform:MetricView", "describe", METADATA, (access, call, language) -> {
            String id = metricId(call);
            try {
                return JSONObject.of("status", "available", "metric", ontology.describeMetric(id, access));
            } catch (ResponseStatusException failure) {
                if (failure.getStatusCode().value() != 404) throw failure;
                return JSONObject.of("status", "unavailable");
            }
        });
    }

    private static String metricId(Map<String, Object> call) {
        if (!(call.get("primaryKey") instanceof String id) || id.isBlank())
            throw new IllegalArgumentException("Metric id is required");
        return id;
    }
}

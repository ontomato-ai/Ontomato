package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.schedules.ScheduleJson;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** Metric parameter forms project the current definition without executing it or changing bindings. */
@Service
public class MetricParameterForms {
  private final MetricViewService metrics;
  private final OntologyQueryService ontology;
  private final SubjectValueResolver subjects;

  public MetricParameterForms(MetricViewService metrics, OntologyQueryService ontology, SubjectValueResolver subjects) {
    this.metrics = metrics;
    this.ontology = ontology;
    this.subjects = subjects;
  }

  public JSONObject form(String id, JSONObject parameters, QueryAccessService.Access access, String lang) {
    var metric = metrics.requireExecutable(id, access.user());
    validate(metric, parameters);
    var values = new JSONObject();
    parameters.forEach((name, value) -> values.put(name, ParameterForms.text(value)));
    return JSONObject.of("revision", OntologyQueryService.revision(metric),
        "fields", ParameterForms.fields(metric.getFunction().getParameters(), ParameterForms.Context.INTERACTIVE, "", lang),
        "values", values, "readOnly", readOnly(metric));
  }

  public JSONObject parse(String id, String revision, JSONObject parameters, JSONObject texts,
      QueryAccessService.Access access, String lang) {
    var metric = ontology.metric(id, revision, access);
    validate(metric, parameters);
    var edited = metric.getFunction().getParameters().stream().filter(p -> texts.containsKey(p.getName())).toList();
    if (edited.size() != texts.size()) throw new IllegalArgumentException("Unknown metric parameter");
    for (String name : readOnly(metric))
      if (texts.containsKey(name)) throw new IllegalArgumentException("Subject parameter is read-only: " + name);
    var parsed = ParameterForms.interactive(edited, ScheduleJson.JSON.valueToTree(texts), Map.of(), List.of(), lang);
    var values = QueryPackage.copy(parameters);
    if (parsed.errors().isEmpty()) {
      values.putAll(parsed.values());
      validate(metric, values);
    }
    return JSONObject.of("revision", revision, "parameters", values, "errors", parsed.errors());
  }

  private void validate(MetricView metric, JSONObject values) {
    subjects.refuseOverrides(metric.getFunction(), values);
    subjects.validateValues(values);
    MetricViewBindings.validateValues(metric.getFunction(), values);
  }

  private List<String> readOnly(MetricView metric) {
    return metric.getFunction().getParameters().stream()
        .filter(p -> p.getValue() instanceof String text && SubjectReference.parse(text) != null)
        .map(p -> p.getName()).toList();
  }
}

package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;

import io.ontomato.dataengine.bean.trigger.Trigger;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.panelreads.OntologyNeighborScope;
import io.ontomato.dataengine.panelreads.WorkbenchPanelRead;
import io.ontomato.dataengine.service.OntologyNeighborFacts.Name;
import io.ontomato.dataengine.service.WorkflowService;
import io.ontomato.dataengine.service.authorization.ActionAuthorization;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class TriggerPanelReads {
  private static final String TYPE = "platform:Trigger";
  private static final String ONTOLOGY = "platform:OntologyType";
  private static final String ACTION = "platform:Action";
  private static final String WORKFLOW = "platform:Workflow";
  private final PlatformTasks tasks;

  TriggerPanelReads(PlatformTasks tasks) {
    this.tasks = tasks;
  }

  @Bean
  WorkbenchPanelRead ontologyTriggerCenter() {
    return new WorkbenchPanelRead(ONTOLOGY, "triggerCenter", (subject, parameters) ->
        tasks.ontologyCenter(subject.asJavaUser(), required(parameters, "primaryKey"))
            .stream().map(TriggerPanelReads::neighborRow).toList());
  }

  @Bean
  WorkbenchPanelRead ontologyIncomingWorkflowTriggers() {
    return incomingTriggers("workflow", WORKFLOW);
  }

  @Bean
  WorkbenchPanelRead ontologyIncomingActionTriggers() {
    return incomingTriggers("action", ACTION);
  }

  private WorkbenchPanelRead incomingTriggers(String targetKind, String targetClass) {
    return new WorkbenchPanelRead(ONTOLOGY, "trigger.targets-" + targetKind, (subject, parameters) -> {
      var scope = OntologyNeighborScope.parse(parameters, TYPE, targetClass);
      if (!scope.incoming()) throw bad("Expected a trigger target center");
      return tasks.ontologyIncoming(subject.asJavaUser(), targetKind, scope.centerId())
          .stream().map(TriggerPanelReads::neighborRow).toList();
    });
  }

  @Bean
  WorkbenchPanelRead ontologyTriggerTargetNames(WorkflowService workflows, ActionDao actions,
      ActionAuthorization authorization) {
    return new WorkbenchPanelRead(ONTOLOGY, "triggerTargetNames", (subject, parameters) -> {
      var id = required(parameters, "primaryKey");
      if (!(parameters.get("targetKinds") instanceof List<?> kinds)
          || kinds.isEmpty() || kinds.stream().anyMatch(kind -> !"workflow".equals(kind) && !"action".equals(kind)))
        throw bad("Expected workflow or action target kinds");
      var viewer = subject.asJavaUser();
      var domain = viewer.identity().domainId();
      return tasks.ontologyCenter(viewer, id).stream().findFirst()
          .map(Trigger::definition)
          .filter(target -> kinds.contains(target.targetKind()))
          .map(target -> switch (target.targetKind()) {
            case "workflow" -> new TargetNames(WORKFLOW, workflows.directoryEntries(domain, Set.of(target.targetId()))
                .stream().map(row -> new Name(row.id(), row.name(), null,
                    row.version() == null ? row.status() : "v" + row.version())).toList());
            case "action" -> new TargetNames(ACTION, actions.definitionDirectoryEntry(domain, target.targetId())
                .stream().filter(action -> authorization.allowsDefinition(viewer, action))
                .map(action -> new Name(action.getId(), action.getName(), null, action.getStatus())).toList());
            default -> throw new IllegalStateException("Unexpected ontology trigger target");
          }).stream().toList();
    });
  }

  private record TargetNames(String className, List<Name> names) {}

  private record NeighborRow(String id, String title, String targetKind, String targetId) {}

  private static NeighborRow neighborRow(Trigger trigger) {
    var target = trigger.definition();
    return new NeighborRow(trigger.id(), target.title(), target.targetKind(), target.targetId());
  }

  @Bean
  WorkbenchPanelRead triggerPanelCount() {
    return new WorkbenchPanelRead(TYPE, "count", (subject, parameters) -> {
      var count = tasks.list(subject.asJavaUser(), null, null, null, false, true);
      return object("rows", array(), "total", count.get("total"));
    });
  }

  @Bean
  WorkbenchPanelRead triggerPanelList() {
    return new WorkbenchPanelRead(TYPE, "list", (subject, parameters) ->
        tasks.list(subject.asJavaUser(), null, null, null, false, false));
  }

  @Bean
  WorkbenchPanelRead triggerPanelStatus() {
    return new WorkbenchPanelRead(TYPE, "status", (subject, parameters) ->
        tasks.list(subject.asJavaUser(), null, null, null, true, false));
  }

  @Bean
  WorkbenchPanelRead triggerPanelRecord() {
    return new WorkbenchPanelRead(TYPE, "record", (subject, parameters) ->
        tasks.detail(subject.asJavaUser(), required(parameters, "primaryKey")));
  }

  @Bean
  WorkbenchPanelRead triggerPanelForm() {
    return new WorkbenchPanelRead(TYPE, "form", (subject, parameters) ->
        tasks.panelForm(subject.asJavaUser(), required(parameters, "primaryKey")));
  }

  @Bean
  WorkbenchPanelRead triggerPanelCreateForm() {
    return new WorkbenchPanelRead(TYPE, "createForm", (subject, parameters) -> tasks.panelCreateForm());
  }

  @Bean
  WorkbenchPanelRead triggerPanelTargets() {
    return new WorkbenchPanelRead(TYPE, "targets", (subject, parameters) -> tasks.targets(subject.asJavaUser()));
  }

  @Bean
  WorkbenchPanelRead triggerPanelRuns() {
    return new WorkbenchPanelRead(TYPE, "runs", (subject, parameters) -> {
      var cursor = optional(parameters, "cursor");
      return tasks.history(subject.asJavaUser(), required(parameters, "primaryKey"), cursor, 20);
    });
  }

  @Bean
  WorkbenchPanelRead triggerPanelRun() {
    return new WorkbenchPanelRead(TYPE, "run", (subject, parameters) ->
        tasks.detail(subject.asJavaUser(), required(parameters, "primaryKey"),
            UUID.fromString(required(parameters, "runId"))));
  }

  @Bean
  WorkbenchPanelRead triggerPanelRunRecord() {
    return new WorkbenchPanelRead(TYPE, "runRecord", (subject, parameters) -> {
      var runId = optional(parameters, "runId");
      return tasks.panelRunRecord(subject.asJavaUser(), required(parameters, "primaryKey"),
          runId == null ? null : UUID.fromString(runId));
    });
  }

  private static String required(Map<String, Object> parameters, String key) {
    var value = optional(parameters, key);
    if (value == null || value.isBlank()) throw bad("Missing " + key);
    return value;
  }

  private static String optional(Map<String, Object> parameters, String key) {
    var value = parameters.get(key);
    if (value != null && !(value instanceof String)) throw bad("Invalid " + key);
    return (String) value;
  }
}

package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;
import static io.ontomato.dataengine.service.authorization.CapabilityDefinitions.access;

import com.fasterxml.jackson.databind.JsonNode;
import io.ontomato.dataengine.bean.trigger.Trigger;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.OntologyNeighborFacts.Name;
import io.ontomato.dataengine.service.PreviewExecution;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Create;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Management;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.AuthorizationService.VerifiedIdentity;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Kind;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import io.ontomato.dataengine.service.authorization.CapabilityDefinitions;
import io.ontomato.dataengine.service.authorization.ManagementOperations;
import io.ontomato.dataengine.service.identity.UserCredentials;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@RequiredArgsConstructor
public class PlatformTasks {
  public static final String CHANGE = "trigger.lifecycle.change";

  @org.springframework.stereotype.Component
  static final class Operations implements ManagementOperations.Contributor {
    @Override public List<ManagementOperations.Operation> managementOperations() {
      return List.of(new ManagementOperations.Operation(CHANGE, "Publish triggers for another member", ManagementOperations.Access.CHANGE));
    }
  }

  private final TaskStore store;
  private final IdentityService identities;
  private final ScheduleIdentity identity;
  private final UserCredentials credentials;
  private final ScheduleApplications applications;
  private final TriggerCapabilities capabilities;
  private final CapabilityDefinitions definitions;
  private final TransactionTemplate transactions;

  @Value("${SCHEDULE_TIMEZONE:}")
  private String configuredZone;

  public record Created(JsonNode task, boolean created) {}
  private record Prepared(TaskDefinition definition, JsonNode summary, boolean requiresCredential) {}

  private User current() {
    var user = identities.getCurrentUser();
    if (user == null || user.getId() == null || user.getDomainId() == null || !user.isEnable())
      throw new ScheduleException(401, "UNAUTHENTICATED", "A current domain user is required");
    identities.getCurrentCredentialExpiresAt();
    return user;
  }

  private String zone() {
    return configuredZone.isBlank() ? ZoneId.systemDefault().getId() : configuredZone;
  }

  private ScheduleApplication.Actor onlineActor(User user, String locale) {
    return new ScheduleApplication.Actor(user, identity.dataPermission(user.getDomainId(), user.getId()),
        identity.onlineToken(), identity.onlineApiKey(), locale);
  }

  private ScheduleApplication.Actor backgroundActor(User user, String key, String locale) {
    return new ScheduleApplication.Actor(user, identity.dataPermission(user.getDomainId(), user.getId()), null, key, locale);
  }

  private User executor(User actor, String id) {
    if (actor.getId().equals(id)) return actor;
    var user = identity.creator(actor.getDomainId(), id);
    if (user == null || !user.isEnable())
      throw new ScheduleException(422, "TARGET_UNAVAILABLE", "The executor is not an active member of this domain");
    return user;
  }

  private static ScheduleException missing() {
    return new ScheduleException(404, "TASK_NOT_FOUND", "Trigger or run not found");
  }

  static SubjectContext panelSubject(SubjectContext subject) {
    var actor = new VerifiedIdentity(subject.identity().domainId(), subject.javaUserId(), subject.identity().limit());
    return new SubjectContext(actor, subject.roles(), subject.policyRefsByRole(), subject.objectPolicyIds(),
        subject.managementPolicyIds(), subject.liveDataPermission(), subject.javaUserId());
  }

  private Trigger accessible(String id, User user, Verb verb, boolean lock) {
    return accessible(id, definitions.subject(user), verb, lock);
  }

  private Trigger accessible(String id, SubjectContext subject, Verb verb, boolean lock) {
    var task = store.get(id, lock);
    if (task == null || !task.domain().equals(subject.identity().domainId())) throw missing();
    if (!canRead(subject, task)) throw missing();
    if (verb != Verb.VIEW) definitions.require(subject, access(task, verb));
    return task;
  }

  private static long revision(JsonNode value) {
    var revision = value.path("revision");
    if (!revision.isIntegralNumber() || !revision.canConvertToLong() || revision.asLong() < 1
        || revision.asLong() > 9007199254740991L) throw bad("Invalid revision");
    return revision.asLong();
  }

  private static void checkRevision(Trigger task, long expected) {
    if (task.revision() != expected)
      throw new ScheduleException(409, "REVISION_CONFLICT", "The trigger changed; reload before editing");
  }

  private void requireIdle(String task) {
    UUID active = store.active(task);
    if (active != null)
      throw new ScheduleException(409, "TASK_RUNNING", "Trigger is already running", Map.of("activeRunId", active));
  }

  private void requireCapacity(TaskDefinition definition, String domain, String creator) {
    if (!definition.application()) return;
    int limit = applications.require(definition.appId(), domain).creatorLimit();
    if (limit > 0 && store.creatorCount(domain, creator, definition.appId()) >= limit)
      throw new ScheduleException(409, "TASK_LIMIT_REACHED", "Application trigger limit reached");
  }

  private static boolean priority(Trigger task, Function<String, String> lastRunStatus) {
    return task.pause() != null || "failed".equals(lastRunStatus.apply(task.id()));
  }

  private static Comparator<Trigger> listOrder(Function<String, String> lastRunStatus) {
    return Comparator.<Trigger, Boolean>comparing(task -> priority(task, lastRunStatus)).reversed()
        .thenComparing(task -> priority(task, lastRunStatus) ? Instant.MAX : task.nextRunAt(),
            Comparator.nullsLast(Comparator.naturalOrder()))
        .thenComparing(Trigger::updatedAt, Comparator.reverseOrder()).thenComparing(Trigger::id);
  }

  private List<JsonNode> views(List<Trigger> tasks, String domainId, String member) {
    var names = capabilities.names(domainId, tasks);
    var runs = store.runViews(tasks.stream().map(Trigger::id).toList(), member).stream()
        .collect(Collectors.toMap(TaskStore.RunViews::id, Function.identity()));
    return tasks.stream().filter(task -> runs.containsKey(task.id()))
        .sorted(listOrder(id -> {
          var lastRun = runs.get(id).lastRun();
          return lastRun == null ? null : lastRun.status();
        }))
        .map(task -> view(task, runs.get(task.id()), names, member)).toList();
  }

  private JsonNode view(Trigger task, User user) {
    return view(task, user.getId());
  }

  private JsonNode view(Trigger task, String member) {
    return views(List.of(task), task.domain(), member).stream().findFirst().orElseThrow(PlatformTasks::missing);
  }

  private static JsonNode view(Trigger task, TaskStore.RunViews runs, TriggerCapabilities.Names names, String member) {
    var definition = task.definition();
    return object("id", task.id(), "creatorId", task.creator(), "executorId", task.executor(),
        "coauthorIds", task.coauthors(), "reviewedBy", task.reviewer(), "status", task.status(), "version", task.version(),
        "title", definition.title(), "description", definition.description(), "targetKind", definition.targetKind(),
        "targetId", definition.targetId(), "targetName", names.forTarget(definition), "appId", definition.appId(),
        "content", definition.content(), "formRevision", definition.formRevision(), "summary", definition.application() ? array() : task.summary(),
        "frequency", definition.frequency(), "timeZone", definition.timeZone(), "notifyEmail", definition.notifyEmail(),
        "enabled", task.enabled(), "pause", pauseView(task, member), "nextRunAt", task.nextRunAt(), "lastFiredAt", task.lastFiredAt(),
        "revision", task.revision(), "createdAt", task.createdAt(), "updatedAt", task.updatedAt(),
        "activeRunId", runs.active(), "lastRun", runs.lastRun() == null ? null : runs.lastRun().summaryView(member),
        "latestResult", runs.latestResult() == null ? null : object("runId", runs.latestResult(), "link", runs.link()));
  }

  private static TaskStore.Failure pauseView(Trigger task, String member) {
    return task.pause() == null || task.executor().equals(member) ? task.pause()
        : new TaskStore.Failure(task.pause().code(), "The trigger is paused");
  }

  public JsonNode list(String app, String kind, String status, boolean includeCredentialStatus, boolean countOnly) {
    return list(definitions.subject(current()), app, kind, status, includeCredentialStatus, countOnly);
  }

  JsonNode list(SubjectContext subject, String app, String kind, String status, boolean includeCredentialStatus, boolean countOnly) {
    if (app != null && !app.matches("[a-z][a-z0-9-]{0,63}")) throw bad("Invalid application ID");
    if (kind != null && !Set.of("action", "workflow", "application").contains(kind)) throw bad("Invalid target kind");
    if (status != null && !Trigger.STATUSES.contains(status)) throw bad("Invalid status");
    var tasks = readable(subject, app, kind, status);
    if (countOnly) return object("total", tasks.size());
    var domain = subject.identity().domainId();
    var member = subject.identity().userId();
    var result = object("tasks", views(tasks, domain, member), "timeZone", zone());
    if (includeCredentialStatus) result.put("credentialStatus", credentialStatus(domain, member));
    return result;
  }

  private List<Trigger> readable(SubjectContext subject, String app, String kind, String status) {
    return store.candidates(subject.identity().domainId(), app, kind, status).stream()
        .filter(task -> canRead(subject, task)).toList();
  }

  List<Trigger> ontologyCenter(SubjectContext subject, String id) {
    return store.ontologyCenter(subject.identity().domainId(), id).stream()
        .filter(task -> canRead(subject, task)).toList();
  }

  public List<Name> ontologyNames(SubjectContext subject, Set<String> ids) {
    var domain = subject.identity().domainId();
    return store.ontologyDirectory(domain, ids).stream()
        .filter(row -> definitions.canRead(subject, CapabilityDefinitions.triggerAccess(domain, row.id(),
            row.creator(), row.status(), row.coauthors(), Verb.USE)))
        .map(row -> new Name(row.id(), row.title(), null, row.targetKind())).toList();
  }

  List<Trigger> ontologyIncoming(SubjectContext subject, String kind, String targetId) {
    var readable = store.ontologyIncoming(subject.identity().domainId(), kind, targetId).stream()
        .filter(task -> canRead(subject, task)).toList();
    var statuses = store.lastRunStatuses(readable.stream().map(Trigger::id).toList());
    return readable.stream().sorted(listOrder(statuses::get)).toList();
  }

  private boolean canRead(SubjectContext subject, Trigger task) {
    return definitions.canRead(subject, access(task, Verb.USE));
  }

  public List<Trigger> policyTargets(String domain) {
    var user = current();
    if (!domain.equals(user.getDomainId())) throw missing();
    return readable(definitions.subject(user), null, null, null).stream().filter(task -> !Trigger.PENDING_REVIEW.equals(task.status())).toList();
  }

  public JsonNode targets() { return targets(definitions.subject(current())); }

  JsonNode targets(SubjectContext subject) { return capabilities.targets(subject); }

  JsonNode panelForm(SubjectContext subject, String id) {
    var task = accessible(id, subject, Verb.VIEW, false);
    return object("task", view(task, subject.identity().userId()),
        "edit", definitions.decide(subject, access(task, Verb.EDIT)));
  }

  JsonNode panelCreateForm() { return object("timeZone", zone()); }

  public JsonNode form(String appId, JsonNode input, String locale) {
    keys(input, "values", "changedField", "taskId", "timeZone");
    content(input.get("values"));
    if (!input.has("changedField") || !input.has("taskId")) throw bad("Missing application form fields");
    String field = optionalText(input, "changedField");
    if (field != null && (field.isEmpty() || field.length() > 256)) throw bad("Invalid changedField");
    String task = optionalText(input, "taskId");
    var user = current();
    if (task != null) accessible(task, user, Verb.EDIT, false);
    String zone = text(input, "timeZone");
    ZoneId.of(zone);
    var provider = application(appId, user);
    var actor = onlineActor(user, locale);
    return provider.form(new ScheduleApplication.FormInput(input.get("values"), field, task, zone), actor);
  }

  private ScheduleApplication application(String appId, User user) {
    var provider = applications.require(appId, user.getDomainId());
    if (!applications.canEnter(appId, user))
      throw new ScheduleException(403, "PERMISSION_DENIED", "Application entry permission is required");
    return provider;
  }

  private static List<String> coauthors(JsonNode input, List<String> previous) {
    if (!input.has("coauthorIds")) return previous;
    var values = input.get("coauthorIds");
    if (!values.isArray()) throw bad("coauthorIds must be a member ID array");
    return StreamSupport.stream(values.spliterator(), false).map(item -> {
      if (!item.isTextual() || item.textValue().isBlank()) throw bad("Invalid coauthor member ID");
      return item.textValue();
    }).distinct().toList();
  }

  private void requireNewCoauthors(User actor, List<String> coauthors, List<String> previous) {
    var existing = Set.copyOf(previous);
    for (String id : coauthors) {
      if (existing.contains(id) || actor.getId().equals(id)) continue;
      var member = identity.creator(actor.getDomainId(), id);
      if (member == null || !member.isEnable() || !id.equals(member.getId()))
        throw bad("Coauthor must be an active member of this domain: " + id);
    }
  }

  private static String executorId(JsonNode input, String creator) {
    String id = optionalText(input, "executorId");
    if (id == null) return creator;
    if (id.isBlank()) throw bad("Invalid executor member ID");
    return id;
  }

  private String review(User actor, String executor, String author, List<String> coauthors) {
    if (actor.getId().equals(executor) && (author.equals(executor) || coauthors.contains(executor))) return null;
    definitions.require(definitions.subject(actor), new Management(CHANGE));
    return actor.getId();
  }

  private Prepared prepare(TaskDefinition definition, User editor, String effectiveExecutor, String locale, boolean publish) {
    var member = executor(editor, effectiveExecutor);
    boolean self = member.getId().equals(editor.getId());
    if (!definition.application()) {
      if (publish) capabilities.authorize(definition, member, locale);
      else capabilities.verifyTarget(definition, editor.getDomainId(), locale);
      boolean needsKey = publish && "workflow".equals(definition.targetKind());
      if (needsKey && self) credentials.prepareForSetup(editor);
      return new Prepared(definition, array(), needsKey && !self && !credentials.hasValidKey(member.getDomainId(), member.getId()));
    }
    var provider = application(definition.appId(), publish ? member : editor);
    boolean needsKey = publish && provider.remote();
    boolean missing = needsKey && !self && !credentials.hasValidKey(member.getDomainId(), member.getId());
    var actor = !publish || self || missing ? onlineActor(editor, locale) : backgroundActor(member,
        needsKey ? credentials.forOwner(member.getDomainId(), member.getId()) : null, locale);
    var validated = provider.validate(definition, actor);
    if (needsKey && self) credentials.prepareForSetup(editor);
    return new Prepared(definition.validated(validated), validated.summary(), missing);
  }

  private static Instant next(Prepared prepared, boolean enabled) {
    if (!enabled || prepared.requiresCredential()) return null;
    var now = Instant.now();
    return prepared.definition().next(now, now);
  }

  private void credentialPause(String id, Prepared prepared, boolean enabled) {
    if (enabled && prepared.requiresCredential())
      store.jdbc().update("UPDATE trigger_def SET pause_code='credential_invalid',pause_message=? WHERE id=?",
          "The executor must renew their background credential", id);
  }

  public Created create(UUID key, JsonNode input, String locale, boolean enabled) {
    var user = current();
    var subject = definitions.subject(user);
    definitions.require(subject, new Create(Kind.TRIGGER));
    var definition = TaskDefinition.input(input, zone(), false);
    String id = key.toString();
    String executor = executorId(input, user.getId());
    var coauthors = coauthors(input, List.of());
    String reviewer = enabled ? review(user, executor, user.getId(), coauthors) : null;
    var previous = store.get(id, false);
    if (previous != null) return replay(previous, user, definition, executor, coauthors, enabled);
    requireNewCoauthors(user, coauthors, List.of());
    var prepared = prepare(definition, user, executor, locale, enabled);
    return transactions.execute(tx -> {
      credentials.lockOwner(user.getDomainId(), user.getId());
      var old = store.get(id, false);
      if (old != null) return replay(old, user, prepared.definition(), executor, coauthors, enabled);
      requireCapacity(definition, user.getDomainId(), user.getId());
      String notifyEmailSetBy = definition.notifyEmail() == null ? null : user.getId();
      if (!store.insert(id, user.getDomainId(), user.getId(), executor, coauthors, prepared.definition(), notifyEmailSetBy,
          prepared.summary(), locale, enabled ? Trigger.PUBLISHED : Trigger.PENDING_REVIEW, reviewer, next(prepared, enabled), enabled))
        throw new ScheduleException(409, "IDEMPOTENCY_CONFLICT", "Idempotency key reused");
      credentialPause(id, prepared, enabled);
      return new Created(view(store.get(id, false), user), true);
    });
  }

  private Created replay(Trigger old, User user, TaskDefinition definition, String executor, List<String> coauthors, boolean enabled) {
    if (old.domain().equals(user.getDomainId()) && old.creator().equals(user.getId()) && old.enabled() == enabled
        && old.executor().equals(executor) && old.coauthors().equals(coauthors) && old.definition().equals(definition))
      return new Created(view(old, user), false);
    throw new ScheduleException(409, "IDEMPOTENCY_CONFLICT", "Idempotency key reused");
  }

  public JsonNode update(String id, JsonNode input, String locale) {
    var user = current();
    var old = accessible(id, user, Verb.EDIT, false);
    long expected = revision(input);
    checkRevision(old, expected);
    requireIdle(id);
    var definition = TaskDefinition.input(input, zone(), true);
    String executor = executorId(input, old.creator());
    var coauthors = coauthors(input, old.coauthors());
    requireNewCoauthors(user, coauthors, old.coauthors());
    boolean publish = Trigger.PUBLISHED.equals(old.status());
    String reviewer = publish ? review(user, executor, old.creator(), old.coauthors()) : old.reviewer();
    var prepared = prepare(definition, user, executor, locale, publish);
    return transactions.execute(tx -> {
      credentials.lockOwner(old.domain(), old.creator());
      var task = accessible(id, user, Verb.EDIT, true);
      checkRevision(task, expected);
      requireIdle(id);
      if (!Objects.equals(task.definition().appId(), definition.appId()))
        requireCapacity(definition, task.domain(), task.creator());
      String notifyEmail = definition.notifyEmail();
      String notifyEmailSetBy = task.notifyEmailSetBy();
      if (!Objects.equals(notifyEmail, task.definition().notifyEmail())) {
        notifyEmailSetBy = notifyEmail == null ? null : user.getId();
      }
      store.update(id, executor, coauthors, prepared.definition(), notifyEmailSetBy, prepared.summary(),
          locale, reviewer, publish, next(prepared, task.enabled()));
      credentialPause(id, prepared, task.enabled());
      return view(store.get(id, false), user);
    });
  }

  public JsonNode enabled(String id, JsonNode input, String locale) {
    keys(input, "enabled", "revision");
    if (!input.path("enabled").isBoolean()) throw bad("Missing enabled flag");
    return lifecycle(id, null, input.get("enabled").booleanValue(), revision(input), locale);
  }

  public JsonNode status(String id, JsonNode input, String locale) {
    keys(input, "status", "revision", "enabled");
    String status = text(input, "status");
    if (!Trigger.STATUSES.contains(status)) throw bad("Invalid status");
    if (input.has("enabled") && !input.get("enabled").isBoolean()) throw bad("Invalid enabled flag");
    return lifecycle(id, status, Trigger.PUBLISHED.equals(status) && input.path("enabled").asBoolean(true), revision(input), locale);
  }

  private JsonNode lifecycle(String id, String status, boolean enabled, long revision, String locale) {
    var user = current();
    var previous = accessible(id, user, Verb.EDIT, false);
    checkRevision(previous, revision);
    String state = status == null ? previous.status() : status;
    if (enabled && !Trigger.PUBLISHED.equals(state)) throw bad("Publish a trigger before enabling it");
    boolean publish = Trigger.PUBLISHED.equals(status);
    String reviewer = publish || enabled ? review(user, previous.executor(), previous.creator(), previous.coauthors()) : previous.reviewer();
    var prepared = publish || enabled ? prepare(previous.definition(), user, previous.executor(), locale, true) : null;
    return transactions.execute(tx -> {
      var task = accessible(id, user, Verb.EDIT, true);
      checkRevision(task, revision);
      store.lifecycle(id, state, enabled, reviewer, publish, next(prepared, enabled));
      if (enabled) credentialPause(id, prepared, true);
      return view(store.get(id, false), user);
    });
  }

  public void delete(String id, String ifMatch) {
    if (!ifMatch.matches("\"[1-9][0-9]*\"")) throw bad("A quoted revision is required");
    long expected = Long.parseLong(ifMatch.substring(1, ifMatch.length() - 1));
    var user = current();
    transactions.executeWithoutResult(tx -> {
      var task = accessible(id, user, Verb.EDIT, true);
      checkRevision(task, expected);
      requireIdle(id);
      store.jdbc().update("DELETE FROM trigger_def WHERE id=?", id);
    });
  }

  /**
   * Starts one run now as the caller. A preview caller is refused before anything is admitted, whatever the target: the
   * run executes it on the spot, and an Action, a workflow or an application all go on to write business data. Saving
   * the trigger and its scheduled runs are not this.
   */
  public JsonNode manual(String id, UUID runId, String locale, boolean preview) {
    var user = current();
    var task = accessible(id, user, Verb.USE, false);
    if (preview) throw new ScheduleException(422, PreviewExecution.WRITE_CODE, PreviewExecution.WRITE_MESSAGE);
    var old = store.run(runId);
    if (old != null) return replayRun(id, old, user);
    prepare(task.definition(), user, user.getId(), locale, true);
    return transactions.execute(tx -> {
      var locked = accessible(id, user, Verb.USE, true);
      checkRevision(locked, task.revision());
      var existing = store.run(runId);
      if (existing != null) return replayRun(id, existing, user);
      requireIdle(id);
      var run = store.admit(locked, user.getId(), runId, "manual", null);
      if (run == null) throw new ScheduleException(409, "IDEMPOTENCY_CONFLICT", "Idempotency key reused");
      return run.wire(user.getId());
    });
  }

  private JsonNode replayRun(String id, TaskStore.Run old, User actor) {
    if (id.equals(old.taskId()) && "manual".equals(old.trigger()) && actor.getId().equals(old.snapshot().executorId()))
      return old.wire(actor.getId());
    throw new ScheduleException(409, "IDEMPOTENCY_CONFLICT", "Idempotency key reused");
  }

  public JsonNode detail(String id) {
    return detail(definitions.subject(current()), id);
  }

  JsonNode detail(SubjectContext subject, String id) {
    return view(accessible(id, subject, Verb.VIEW, false), subject.identity().userId());
  }

  private TaskStore.Run run(Trigger task, UUID runId, String member) {
    var run = store.run(runId);
    if (run == null || !task.id().equals(run.taskId()) || !task.domain().equals(run.snapshot().domainId())
        || !(member.equals(run.snapshot().executorId()) || run.snapshot().executorId() == null && member.equals(task.creator())))
      throw missing();
    return run;
  }

  public JsonNode detail(String id, UUID runId) {
    return detail(definitions.subject(current()), id, runId);
  }

  JsonNode detail(SubjectContext subject, String id, UUID runId) {
    var member = subject.identity().userId();
    return run(accessible(id, subject, Verb.VIEW, false), runId, member).wire(member);
  }

  public JsonNode history(String id, String cursor, int limit) {
    return history(definitions.subject(current()), id, cursor, limit);
  }

  JsonNode history(SubjectContext subject, String id, String cursor, int limit) {
    return history(accessible(id, subject, Verb.VIEW, false), subject.identity().userId(), cursor, limit);
  }

  private JsonNode history(Trigger task, String member, String cursor, int limit) {
    if (limit < 1 || limit > 100) throw bad("Invalid limit");
    var after = cursor == null ? null : run(task, UUID.fromString(cursor), member);
    var rows = store.history(task, member, after == null ? null : after.startedAt(), after == null ? null : after.id(), limit + 1);
    var selected = rows.subList(0, Math.min(limit, rows.size()));
    return object("runs", selected.stream().map(run -> run.wire(member)).toList(),
        "nextCursor", rows.size() > limit ? selected.getLast().id().toString() : null);
  }

  JsonNode panelRunRecord(SubjectContext subject, String id, UUID runId) {
    var task = accessible(id, subject, Verb.VIEW, false);
    var member = subject.identity().userId();
    if (runId != null) return object("run", run(task, runId, member).wire(member));
    return object("task", view(task, member), "history", history(task, member, null, 1));
  }

  private static boolean pausedForCredential(Trigger task) {
    return task.enabled() && task.pause() != null && "credential_invalid".equals(task.pause().code());
  }

  private String credentialStatus(String domain, String member) {
    var tasks = store.executedBy(domain, member);
    if (tasks.isEmpty()) return "no-remote-tasks";
    return tasks.stream().anyMatch(PlatformTasks::pausedForCredential) || !credentials.hasValidKey(domain, member)
        ? "renewal-required" : "valid";
  }

  public void renewOnVisit(String locale) {
    var user = current();
    var tasks = store.executedBy(user.getDomainId(), user.getId());
    if (tasks.isEmpty()) return;
    if (!identity.interactiveLogin()) throw new ScheduleException(403, "INTERACTIVE_LOGIN_REQUIRED", "A login session is required");
    credentials.prepareForSetup(user);
    for (var task : tasks) {
      if (!pausedForCredential(task)) continue;
      try {
        var prepared = prepare(task.definition(), user, user.getId(), locale, true);
        store.jdbc().update("""
            UPDATE trigger_def SET pause_code=NULL,pause_message=NULL,next_run_at=?,revision=revision+1,updated_at=now()
            WHERE id=? AND revision=? AND enabled AND pause_code='credential_invalid'
            """, TaskStore.timestamp(next(prepared, true)), task.id(), task.revision());
      } catch (ScheduleException invalid) {
        String pause = switch (invalid.code) {
          case "PERMISSION_DENIED" -> "permission_denied";
          case "FORM_CHANGED" -> "definition_changed";
          case "FIELD_VALIDATION_FAILED", "TARGET_UNAVAILABLE" -> "target_unavailable";
          case "APPLICATION_NOT_FOUND" -> "application_unavailable";
          default -> throw invalid;
        };
        store.jdbc().update("""
            UPDATE trigger_def SET pause_code=?,pause_message=?,revision=revision+1,updated_at=now()
            WHERE id=? AND revision=? AND enabled AND pause_code='credential_invalid'
            """, pause, invalid.getReason(), task.id(), task.revision());
      }
    }
  }
}

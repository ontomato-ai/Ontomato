package io.ontomato.dataengine.panelreads;

import static io.ontomato.dataengine.panelreads.WorkbenchPanelReadsController.*;
import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;
import static java.util.concurrent.TimeUnit.MILLISECONDS;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.applications.ApplicationCatalog;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dataAdapter.DslContractViolationException;
import io.ontomato.dataengine.service.DataPermissionLookup;
import io.ontomato.dataengine.service.ExecutionTarget;
import io.ontomato.dataengine.service.OntologyModelException;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.PythonRows;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.QueryAccessService.Access;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.agent.AgentExecutionScope;
import io.ontomato.dataengine.service.authorization.ActionAuthorization;
import io.ontomato.dataengine.service.authorization.AuthorizationPolicies;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.ObjectAccess;
import io.ontomato.dataengine.service.authorization.AuthorizationService.ObjectVisibilityRange;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.CapabilityDefinitions;
import io.ontomato.dataengine.schedules.ScheduleException;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeoutException;
import java.util.function.BiFunction;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.TransactionSystemException;
import org.springframework.transaction.TransactionTimedOutException;
import org.springframework.web.server.ResponseStatusException;

@Service
@Slf4j
final class WorkbenchPanelReads {
    private static final long DEFAULT_TIMEOUT_MS = 600_000;
    private static final Set<Kind> CATALOGUE_KINDS = Set.of(Kind.PANEL, Kind.PROJECTION, Kind.COMPONENT, Kind.AGENT);
    private record ReadKey(String type, String name) {}

    private final ApplicationCatalog applications;
    private final AuthorizationService authorization;
    private final WorkbenchPanelReadExecutor executor;
    private final QueryAccessService queries;
    private final AgentExecutionScope executionScope;
    private final DataPermissionLookup dataPermissions;
    private final ObjectMapper json;
    private final Map<ReadKey, WorkbenchReadRegistration> handlers;

    WorkbenchPanelReads(ApplicationCatalog applications, AuthorizationService authorization,
                        WorkbenchPanelReadExecutor executor, QueryAccessService queries, AgentExecutionScope executionScope,
                        DataPermissionLookup dataPermissions, ObjectMapper json, List<WorkbenchReadRegistration> handlers) {
        this.applications = applications;
        this.authorization = authorization;
        this.executor = executor;
        this.queries = queries;
        this.executionScope = executionScope;
        this.dataPermissions = dataPermissions;
        this.json = json;
        this.handlers = handlers.stream().collect(Collectors.toUnmodifiableMap(
            handler -> new ReadKey(handler.type(), handler.name()), Function.identity()));
    }

    OpenResult open(Open request, SubjectContext subject, Viewer viewer) {
        var entry = request.entry();
        if (entry == null || !(entry.path() == null
                ? !blank(entry.applicationId()) && !blank(entry.useId())
                : !blank(entry.path()) && entry.applicationId() == null && entry.useId() == null))
            throw badRequest("An entry path or applicationId/useId is required");
        var resolved = applications.openPanelEntry(entry.path(), entry.applicationId(), entry.useId(), subject);
        return new OpenResult(resolved, ranges(subject, request.visibleKinds()), viewer);
    }

    LocateResult locate(Locate request, Viewer viewer) {
        if (request.entries() == null) throw badRequest("An entries array is required");
        if (request.entries().isEmpty()) return new LocateResult(viewer, List.of());
        var registrations = applications.panelReadRegistrations(viewer.domainId());
        var locations = new ArrayList<LocatedEntry>();
        for (var key : request.entries()) {
            if (key == null || blank(key.applicationId()) || blank(key.useId())) {
                locations.add(new LocatedEntry("error", null, 400, null, "An applicationId and useId are required"));
                continue;
            }
            ApplicationCatalog.PanelReadRegistration entry;
            try {
                entry = registrations.apply(key.applicationId(), key.useId());
            } catch (ResponseStatusException e) {
                locations.add(new LocatedEntry("error", null, e.getStatusCode().value(), null, e.getReason()));
                continue;
            }
            locations.add(new LocatedEntry("ready", entry, null, null, null));
        }
        return new LocateResult(viewer, locations);
    }

    boolean acceptsCallerScope(Call call) {
        var handler = registeredHandler(call);
        return handler instanceof WorkbenchProductGraphRead || (handler instanceof WorkbenchPanelRead.Query query ? query.acceptsCallerScope()
            : handler instanceof WorkbenchPanelRead read && read.handler() instanceof WorkbenchPanelRead.CallerScopedHandler);
    }

    private WorkbenchReadRegistration registeredHandler(Call call) {
        return call == null ? null : handlers.get(new ReadKey(call.type(), call.name()));
    }

    ReadResult read(Read batch, SubjectContext subject, Viewer viewer, User user, long start, Locale locale, String language,
            String caller) {
        var livePermission = new FutureTask<>(() -> dataPermissions.getDataPermission(user.getId(), user.getDomainId()));
        var queryAccess = new FutureTask<>(() -> {
            var access = queries.captureLivePanelAccess(user, () -> capture(livePermission));
            return caller == null ? access : executionScope.queryAccess(caller, access);
        });
        Function<UserDataPermission, ExecutionTarget> callerScope =
            caller == null ? null : permission -> executionScope.callerTarget(caller, user, permission);
        var registrations = applications.panelReadRegistrations(subject.identity().domainId());
        var tasks = batch.reads().stream()
            .map(item -> plan(subject, item, registrations, start, locale, livePermission, queryAccess, language, callerScope)).toList();
        return new ReadResult(viewer, tasks.stream().map(Supplier::get).toList());
    }

    private Supplier<ItemResult> plan(SubjectContext subject, ReadItem item,
            BiFunction<String, String, ApplicationCatalog.PanelReadRegistration> registrations, long start, Locale locale,
            FutureTask<UserDataPermission> livePermission, FutureTask<Access> queryAccess, String language,
            Function<UserDataPermission, ExecutionTarget> callerScope) {
        if (item == null || item.timeoutMs() != null && (item.timeoutMs() <= 0 || item.timeoutMs() > DEFAULT_TIMEOUT_MS))
            return () -> failed(Status.ERROR, "PANEL_READ_INVALID", "Invalid read item or timeout");
        var handler = registeredHandler(item.call());
        if (handler instanceof WorkbenchPanelRead.Query query
                && query.execution() == WorkbenchPanelRead.QueryExecution.REQUEST_THREAD)
            return () -> readQuery(subject, item, registrations, query, queryAccess, language);
        long timeout = item.timeoutMs() == null ? DEFAULT_TIMEOUT_MS : item.timeoutMs();
        long deadline = start + MILLISECONDS.toNanos(timeout);
        if (handler instanceof WorkbenchPanelRead.Query || handler instanceof WorkbenchProductGraphRead
                || handler instanceof WorkbenchPanelRead metadata && metadata.requiresLiveData())
            return planCapturedMetadata(subject, item, registrations, handler, livePermission, queryAccess, locale, language, deadline, callerScope);
        var result = executor.submit(deadline,
            () -> readMetadata(subject, item, registrations, locale, (WorkbenchPanelRead) handler, callerScope))
            .exceptionally(failure -> itemFailure(failure, false));
        return result::join;
    }

    private ItemResult readQuery(SubjectContext subject, ReadItem item,
            BiFunction<String, String, ApplicationCatalog.PanelReadRegistration> registrations,
            WorkbenchPanelRead.Query handler, FutureTask<Access> queryAccess, String language) {
        try {
            var admission = admit(subject, item, registrations, handler);
            if (admission.status() != Status.READY) return admission;
            return invokeQuery(capture(queryAccess), item, handler, language, admission);
        } catch (Exception failure) {
            return captureFailure(failure, true);
        }
    }

    private Supplier<ItemResult> planCapturedMetadata(SubjectContext subject, ReadItem item,
            BiFunction<String, String, ApplicationCatalog.PanelReadRegistration> registrations,
            WorkbenchReadRegistration handler, FutureTask<UserDataPermission> livePermission, FutureTask<Access> queryAccess,
            Locale locale, String language, long deadline,
            Function<UserDataPermission, ExecutionTarget> callerScope) {
        boolean queryRead = handler instanceof WorkbenchPanelRead.Query;
        try {
            var admission = admit(subject, item, registrations, handler);
            if (admission.status() != Status.READY) return () -> admission;
            if (handler instanceof WorkbenchPanelRead.Query query) {
                var access = capture(queryAccess);
                var result = executor.submit(deadline, () -> {
                    try {
                        if (callerScope != null && access.expiresAt() <= System.currentTimeMillis())
                            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "The user credential expired");
                        return invokeQuery(access, item, query, language, admission);
                    } catch (Exception failure) {
                        throw new CompletionException(failure);
                    }
                }).exceptionally(failure -> itemFailure(failure, true));
                return result::join;
            }
            if (handler instanceof WorkbenchProductGraphRead graph) {
                var references = WorkbenchProductGraphRead.References.parse(item.call().parameters());
                // Query admission may fail independently of the other graph facts. Capture it on this thread.
                if (!references.metrics().isEmpty()) queryAccess.run();
                var result = executor.submitProductGraph(deadline, () -> invokeMetadata(locale, admission,
                        () -> graph.read(subject, references, queryAccess::get, deadline)))
                    .exceptionally(failure -> itemFailure(failure, false));
                return result::join;
            }
            var captured = subject.withLiveDataPermission(capture(livePermission));
            var owner = ((WorkbenchPanelRead) handler).handler();
            var result = executor.submit(deadline, () -> invokeMetadata(locale, admission,
                    () -> invokeOwner(owner, captured, item.call(), callerScope)))
                .exceptionally(failure -> itemFailure(failure, false));
            return result::join;
        } catch (Exception failure) {
            var result = captureFailure(failure, queryRead);
            return () -> result;
        }
    }

    private static <T> T capture(FutureTask<T> facts) throws InterruptedException, ExecutionException {
        // Capture only on the originating request thread, after placement USE.
        facts.run();
        return facts.get();
    }

    private static ItemResult invokeQuery(Access access, ReadItem item, WorkbenchPanelRead.Query handler,
            String language, ItemResult admission) throws Exception {
        return answered(handler.handler().read(access, item.call().parameters(), language), admission);
    }

    static ItemResult captureFailure(Throwable failure, boolean query) {
        if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
        return itemFailure(failure, query);
    }

    private ItemResult readMetadata(SubjectContext subject, ReadItem item,
            BiFunction<String, String, ApplicationCatalog.PanelReadRegistration> registrations, Locale locale,
            WorkbenchPanelRead handler, Function<UserDataPermission, ExecutionTarget> callerScope) {
        var admission = admit(subject, item, registrations, handler);
        if (admission.status() != Status.READY || handler == null) return admission;
        return invokeMetadata(locale, admission, () -> invokeOwner(handler.handler(), subject, item.call(), callerScope));
    }

    private static Object invokeOwner(WorkbenchPanelRead.Handler owner, SubjectContext subject, Call call,
            Function<UserDataPermission, ExecutionTarget> callerScope) {
        if (callerScope == null) return owner.read(subject, call.parameters());
        return ((WorkbenchPanelRead.CallerScopedHandler) owner).read(
                subject, call.parameters(), callerScope.apply(subject.liveDataPermission()));
    }

    private static ItemResult invokeMetadata(Locale locale, ItemResult admission, Supplier<Object> read) {
        LocaleContextHolder.setLocale(locale);
        try {
            return answered(read.get(), admission);
        } finally {
            LocaleContextHolder.resetLocaleContext();
        }
    }

    private static ItemResult answered(Object payload, ItemResult admission) {
        return new ItemResult(payload == null ? Status.EMPTY : Status.READY, null, null, payload, admission.visibility());
    }

    private ItemResult admit(SubjectContext subject, ReadItem item,
            BiFunction<String, String, ApplicationCatalog.PanelReadRegistration> registrations,
            WorkbenchReadRegistration handler) {
        var source = item.source();
        if (source != null && source.kind() == SourceKind.DIRECT) return admitDirect(subject, item, handler);
        var prepared = item.registration();
        if (source == null || source.kind() == null || blank(source.applicationId()) || blank(source.useId())
                || prepared == null || blank(prepared.framePanelId())
                || source.kind() == SourceKind.REGISTERED && blank(prepared.panelId()))
            throw badRequest("The registered source and its prepared entry facts are required");
        ApplicationCatalog.PanelReadRegistration current;
        try {
            current = registrations.apply(source.applicationId(), source.useId());
        } catch (ResponseStatusException e) {
            if (e.getStatusCode().value() != 404) throw e;
            return changed();
        }
        if (!Objects.equals(prepared.panelId(), current.use().panelId()) || !prepared.framePanelId().equals(current.framePanelId())
                || !sameInputs(prepared.inputs(), current.use().inputs())) return changed();

        var call = item.call();
        if (item.uses() == null) throw badRequest("A uses array is required");
        for (var use : item.uses()) {
            if (use == null || use.target() == null || use.target().kind() == null || blank(use.target().id()) || use.ownerFacts() == null)
                throw badRequest("A USE target and its owner facts are required");
            AuthorizationPolicies.requireObjectDecision(use.target().kind(), use.target().id(), Verb.USE);
            var decision = authorization.decide(subject, new ObjectAccess(use.target(), Verb.USE, use.ownerFacts()));
            if (!decision.allowed()) return failed(Status.FORBIDDEN, decision.code(), decision.reason());
        }
        var visibility = item.visibleKinds() == null ? null : ranges(subject, item.visibleKinds());
        if (call != null) {
            if (blank(call.type()) || blank(call.name()) || call.parameters() == null)
                throw badRequest("An owner read type, name and parameters are required");
            if (handler == null) return failed(Status.ERROR, "PANEL_READ_UNKNOWN", "The owner read is not registered");
        }
        return new ItemResult(Status.READY, null, null, null, visibility);
    }

    /**
     * A direct read carries no application placement: nothing to compare against a registration and no USE admission,
     * so the owner judges the person's verified identity by itself. Data-query reads capture their access from the
     * placement request and are not available here.
     */
    private ItemResult admitDirect(SubjectContext subject, ReadItem item, WorkbenchReadRegistration handler) {
        var source = item.source();
        if (!blank(source.applicationId()) || !blank(source.useId()) || item.registration() != null || item.uses() != null)
            throw badRequest("A direct read carries no application or registration facts");
        if (handler instanceof WorkbenchPanelRead.Query || handler instanceof WorkbenchProductGraphRead
                || handler instanceof WorkbenchPanelRead metadata && metadata.requiresLiveData())
            return failed(Status.FORBIDDEN, "PANEL_READ_NOT_DIRECT", "The owner read is not available without an application placement");
        var visibility = item.visibleKinds() == null ? null : ranges(subject, item.visibleKinds());
        var call = item.call();
        if (call != null) {
            if (blank(call.type()) || blank(call.name()) || call.parameters() == null)
                throw badRequest("An owner read type, name and parameters are required");
            if (handler == null) return failed(Status.ERROR, "PANEL_READ_UNKNOWN", "The owner read is not registered");
        }
        return new ItemResult(Status.READY, null, null, null, visibility);
    }

    private boolean sameInputs(Map<String, Map<String, Object>> prepared, Map<String, Map<String, Object>> current) {
        JsonNode supplied = json.valueToTree(prepared);
        JsonNode actual = json.valueToTree(current);
        // JSON numbers can round-trip through Node as 1 rather than 1.0. Object member order is not a fact.
        return supplied.equals((left, right) -> left.isNumber() && right.isNumber()
            ? left.decimalValue().compareTo(right.decimalValue()) : left.equals(right) ? 0 : 1, actual);
    }

    private Map<Kind, Map<Verb, ObjectVisibilityRange>> ranges(SubjectContext subject, List<VisibleKind> requested) {
        if (requested == null) return Map.of();
        var ranges = new EnumMap<Kind, Map<Verb, ObjectVisibilityRange>>(Kind.class);
        for (var item : requested) {
            if (item == null || item.kind() == null || !CATALOGUE_KINDS.contains(item.kind()) || item.verbs() == null
                    || item.verbs().isEmpty() || ranges.containsKey(item.kind()))
                throw badRequest("Each visibility kind must be a distinct catalogue kind with access verbs");
            item.verbs().forEach(verb -> AuthorizationPolicies.requireObjectReadVerb(item.kind(), verb));
            ranges.put(item.kind(), authorization.readObjectRanges(subject, item.kind(), item.verbs()));
        }
        return ranges;
    }

    private static ItemResult itemFailure(Throwable e, boolean query) {
        var cause = e;
        while (cause instanceof CompletionException || cause instanceof ExecutionException) cause = cause.getCause();
        if (cause instanceof TimeoutException || cause instanceof TransactionTimedOutException
                || cause instanceof QueryTimeoutException || postgresTimedOut(cause))
            return failed(Status.ERROR, "PANEL_READ_TIMEOUT", "The panel read deadline expired");
        if (cause instanceof ActionAuthorization.Denied denied)
            return failed(Status.FORBIDDEN, denied.code(), denied.getMessage());
        if (cause instanceof CapabilityDefinitions.Denied denied)
            return failed(Status.FORBIDDEN, denied.code(), denied.getReason());
        if (cause instanceof OwnerRefusal refusal)
            return failed(Status.ERROR, refusal.code(), refusal.getMessage());
        if (cause instanceof OntologyModelException failure)
            return rejected(failure.status(), failure.code(), failure.getMessage());
        if (cause instanceof ScheduleException failure) {
            var status = failure.getStatusCode().value() == 403 ? Status.FORBIDDEN : Status.ERROR;
            return failed(status, failure.code, failure.getReason());
        }
        if (cause instanceof ResponseStatusException failure) {
            int status = failure.getStatusCode().value();
            if (!query || status == 403) return rejected(status, null, failure.getReason());
            if (failure.getStatusCode().is4xxClientError())
                return failed(Status.ERROR, status == 401 ? "UNAUTHENTICATED" : null, failure.getReason());
        }
        if (query && (cause instanceof DslContractViolationException || cause instanceof IllegalArgumentException
                || cause instanceof PythonRows.InvalidResult))
            return failed(Status.ERROR, "ONTOLOGY_QUERY_FAILED", cause.getMessage());
        if (cause instanceof AgentHttpException failure)
            return query
                ? failed(failure.status() == 403 ? Status.FORBIDDEN : Status.ERROR, failure.code(), failure.getMessage())
                : rejected(failure.status(), failure.code(), failure.getMessage());
        if (cause instanceof Error fatal) throw fatal;
        log.error("The owner read failed", cause);
        return failed(Status.ERROR, "PANEL_READ_ERROR", "The owner read failed");
    }

    private static boolean postgresTimedOut(Throwable failure) {
        for (var error = failure; error != null; error = error.getCause()) {
            if (error instanceof SQLException sql && "25P04".equals(sql.getSQLState())) return true;
            if (error instanceof TransactionSystemException tx && tx.getApplicationException() != null
                    && postgresTimedOut(tx.getApplicationException())) return true;
        }
        return false;
    }

    private static ItemResult rejected(int status, String code, String reason) {
        var message = reason != null ? reason : "Owner read returned HTTP " + status;
        if (status == 401 || status == 403) return failed(Status.FORBIDDEN, code, message);
        if (status == 404) return failed(Status.EMPTY, code, message);
        return failed(Status.ERROR, code, message);
    }

    private static ItemResult changed() {
        return failed(Status.FORBIDDEN, "PANEL_ENTRY_CHANGED", "The application registration changed while preparing this read");
    }

    private static ItemResult failed(Status status, String code, String reason) {
        return new ItemResult(status, code, reason, null, null);
    }

    private static ResponseStatusException badRequest(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }
}

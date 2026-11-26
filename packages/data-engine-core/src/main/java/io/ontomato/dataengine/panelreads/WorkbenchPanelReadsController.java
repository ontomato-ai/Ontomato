package io.ontomato.dataengine.panelreads;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import io.ontomato.dataengine.applications.ApplicationCatalog.PanelReadRegistration;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.logging.ServiceLogContext;
import io.ontomato.dataengine.service.DataSandboxService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.agent.AgentExecutionScope;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.CredentialLimit;
import io.ontomato.dataengine.service.authorization.AuthorizationService.ObjectVisibilityRange;
import io.ontomato.dataengine.service.authorization.AuthorizationService.VerifiedIdentity;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public final class WorkbenchPanelReadsController {
    public static final String PATH = "/internal/workbench-panel-reads";

    @JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "kind")
    @JsonSubTypes({@JsonSubTypes.Type(value = Open.class, name = "open"),
        @JsonSubTypes.Type(value = Locate.class, name = "locate"),
        @JsonSubTypes.Type(value = Read.class, name = "read")})
    public sealed interface Request permits Open, Locate, Read {}

    public record Open(Entry entry, List<VisibleKind> visibleKinds) implements Request {}
    public record Locate(List<EntryKey> entries) implements Request {}
    public record Read(ViewerKey viewer, List<ReadItem> reads) implements Request {}
    public record Entry(String path, String applicationId, String useId) {}
    public record EntryKey(String applicationId, String useId, SourceKind kind) {}
    public record VisibleKind(Kind kind, Set<Verb> verbs) {}
    public enum SourceKind { @JsonProperty("registered") REGISTERED, @JsonProperty("frame") FRAME }
    public record Source(SourceKind kind, String applicationId, String useId) {}
    public record Registration(String panelId, String framePanelId, Map<String, Map<String, Object>> inputs) {}
    public record Use(ObjectTarget target, OwnerFacts ownerFacts) {}
    public record Call(String type, String name, Map<String, Object> parameters) {}
    public record ReadItem(Source source, Registration registration, List<Use> uses, List<VisibleKind> visibleKinds,
                           Call call, Long timeoutMs) {}

    /** Workbench-owned reads use this identity, not a transferable authorization decision. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Viewer(String userId, String domainId, String userName) {}
    public record ViewerKey(String userId, String domainId) {}
    public record OpenResult(JSONObject entry, Map<Kind, Map<Verb, ObjectVisibilityRange>> visibility, Viewer viewer) {}
    public record LocateResult(Viewer viewer, List<LocatedEntry> entries) {}
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LocatedEntry(String kind, PanelReadRegistration entry, Integer status, String code, String error) {}
    public record ReadResult(Viewer viewer, List<ItemResult> results) {}
    public enum Status {
        @JsonProperty("ready") READY, @JsonProperty("empty") EMPTY,
        @JsonProperty("forbidden") FORBIDDEN, @JsonProperty("error") ERROR
    }
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ItemResult(Status status, String code, String error, Object payload,
                             Map<Kind, Map<Verb, ObjectVisibilityRange>> visibility) {}

    private final WorkbenchServiceAuthentication workbench;
    private final IdentityService identity;
    private final AuthorizationService authorization;
    private final WorkbenchPanelReads reads;
    WorkbenchPanelReadsController(WorkbenchServiceAuthentication workbench, IdentityService identity,
                                  AuthorizationService authorization, WorkbenchPanelReads reads) {
        this.workbench = workbench;
        this.identity = identity;
        this.authorization = authorization;
        this.reads = reads;
    }

    @Owned
    @PostMapping(PATH)
    public Object execute(HttpServletRequest servlet, @RequestBody Request request) {
        long start = System.nanoTime();
        workbench.authenticate(servlet);
        var user = verifiedUser(servlet);
        ServiceLogContext.user(user);
        var viewer = new Viewer(identity.workbenchSubjectId(user), user.getDomainId(), user.getUserName());
        String caller = servlet.getHeader(AgentExecutionScope.CALLER_HEADER);
        if (caller != null) requireCallerScopedRead(request);
        return switch (request) {
            case Locate locate -> reads.locate(locate, viewer);
            case Open open -> reads.open(open, subject(viewer), viewer);
            case Read read -> {
                if (read.viewer() == null || blank(read.viewer().userId()) || blank(read.viewer().domainId()))
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected viewer identity and domain are required");
                if (!viewer.userId().equals(read.viewer().userId()) || !viewer.domainId().equals(read.viewer().domainId()))
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "The viewer changed between panel read requests");
                if (read.reads() == null)
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A reads array is required");
                if (read.reads().isEmpty())
                    yield new ReadResult(viewer, List.of());
                yield reads.read(read, subject(viewer).withJavaUserId(user.getId()), viewer, user, start, LocaleContextHolder.getLocale(),
                    Objects.requireNonNullElse(servlet.getHeader("Accept-Language"), "en"),
                    caller);
            }
        };
    }

    private void requireCallerScopedRead(Request request) {
        if (request instanceof Read read && read.reads() != null && read.reads().size() == 1) {
            var item = read.reads().getFirst();
            if (item != null && item.visibleKinds() == null && reads.acceptsCallerScope(item.call()))
                return;
        }
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Caller scope requires one registered read that accepts it");
    }

    private AuthorizationService.SubjectContext subject(Viewer viewer) {
        return authorization.resolveSubject(new VerifiedIdentity(viewer.domainId(), viewer.userId(), CredentialLimit.UNRESTRICTED));
    }

    private User verifiedUser(HttpServletRequest request) {
        if (request.getAttribute(QueryGrantService.ATTRIBUTE) != null || request.getHeader(DataSandboxService.HEADER) != null)
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Ordinary user authentication is required");
        var user = identity.verifyWorkbenchPanelViewer();
        if (user == null || !user.isEnable() || blank(user.getId()))
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "An active user is required");
        if (blank(user.getDomainId()))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "A business domain is required");
        return user;
    }

    static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}

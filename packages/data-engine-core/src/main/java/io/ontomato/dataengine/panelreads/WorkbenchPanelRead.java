package io.ontomato.dataengine.panelreads;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.ExecutionTarget;
import io.ontomato.dataengine.service.QueryAccessService.Access;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import java.util.Map;
import org.springframework.context.i18n.LocaleContextHolder;

/** An owner's existing read, registered as a Spring bean under the projection's type and read name. */
public record WorkbenchPanelRead(String type, String name, Handler handler, boolean requiresLiveData) implements WorkbenchReadRegistration {
    public WorkbenchPanelRead(String type, String name, Handler handler) {
        this(type, name, handler, false);
    }

    public static WorkbenchPanelRead liveData(String type, String name, Handler handler) {
        return new WorkbenchPanelRead(type, name, handler, true);
    }

    public static WorkbenchPanelRead callerScopedLiveData(String type, String name, CallerScopedHandler handler) {
        return liveData(type, name, handler);
    }

    public static WorkbenchPanelRead callerScopedMetadata(String type, String name, CallerScopedHandler handler) {
        return new WorkbenchPanelRead(type, name, handler);
    }

    public enum QueryExecution { METADATA, REQUEST_THREAD }

    public record Query(String type, String name, QueryExecution execution, boolean acceptsCallerScope, QueryHandler handler)
            implements WorkbenchReadRegistration {
        public Query(String type, String name, QueryExecution execution, QueryHandler handler) {
            this(type, name, execution, false, handler);
        }

        public static Query callerScoped(String type, String name, QueryExecution execution, QueryHandler handler) {
            return new Query(type, name, execution, true, handler);
        }
    }

    public static WorkbenchPanelRead form(String type, boolean draft, FormReader reader) {
        return new WorkbenchPanelRead(type, draft ? "createForm" : "form", (subject, parameters) -> {
            var target = draft ? JSONObject.of("kind", "draft")
                : JSONObject.of("kind", "object", "objectType", type, "primaryKey", parameters.get("primaryKey"));
            var request = JSONObject.of("target", target, "values", parameters.get("values"),
                "changedField", parameters.get("changedField"));
            return reader.read(request, LocaleContextHolder.getLocale().toLanguageTag(), subject);
        });
    }

    @FunctionalInterface
    public interface FormReader {
        JSONObject read(JSONObject request, String language, SubjectContext subject);
    }

    @FunctionalInterface
    public interface Handler {
        /** Uses the given subject, not servlet state. Null denotes an empty read. */
        Object read(SubjectContext subject, Map<String, Object> parameters);
    }

    @FunctionalInterface
    public interface CallerScopedHandler extends Handler {
        /** The owner must apply the recovered caller target before reading its facts. */
        Object read(SubjectContext subject, Map<String, Object> parameters, ExecutionTarget target);

        @Override
        default Object read(SubjectContext subject, Map<String, Object> parameters) {
            return read(subject, parameters, ExecutionTarget.LIVE);
        }
    }

    @FunctionalInterface
    public interface QueryHandler {
        /** Uses the query access captured on the originating request thread after placement USE. */
        Object read(Access access, Map<String, Object> parameters, String language) throws Exception;
    }
}

sealed interface WorkbenchReadRegistration permits WorkbenchPanelRead, WorkbenchPanelRead.Query, WorkbenchProductGraphRead {
    String type();
    String name();
}

package io.ontomato.dataengine.applications;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.web.util.UriUtils;

/** Java owns entry facts; panels retain only their shared content and manifest. */
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApplicationPanelUse(String id, String pageKey, String panelId, String path,
                                  Access access, DefaultAgentTarget defaultAgent, Map<String, String> names,
                                  @JsonDeserialize(using = DescriptionsDeserializer.class) Map<String, String> descriptions,
                                  Map<String, Map<String, Object>> inputs, String groupKey, String icon, String kind,
                                  String pageComposer) {
    public static final String NATIVE_KIND = "native";
    public static final String FRAME_CONVERSATION_KIND = "frame-conversation";
    public static final String PAGE_COMPOSER_BOTTOM = "bottom";
    public static final String PAGE_COMPOSER_NONE = "none";

    public ApplicationPanelUse(String id, String pageKey, String panelId, String path, Access access,
                               DefaultAgentTarget defaultAgent, Map<String, String> names) {
        this(id, pageKey, panelId, path, access, defaultAgent, names, null, null, null, null, null, null);
    }
    public ApplicationPanelUse(String id, String pageKey, String panelId, String path, Access access,
                               DefaultAgentTarget defaultAgent, Map<String, String> names,
                               Map<String, Map<String, Object>> inputs, String groupKey) {
        this(id, pageKey, panelId, path, access, defaultAgent, names, null, inputs, groupKey, null, null, null);
    }
    public ApplicationPanelUse(String id, String pageKey, String panelId, String path, Access access,
                               DefaultAgentTarget defaultAgent, Map<String, String> names,
                               Map<String, String> descriptions,
                               Map<String, Map<String, Object>> inputs, String groupKey) {
        this(id, pageKey, panelId, path, access, defaultAgent, names, descriptions, inputs, groupKey, null, null, null);
    }
    public ApplicationPanelUse(String id, String pageKey, String panelId, String path, Access access,
                               DefaultAgentTarget defaultAgent, Map<String, String> names,
                               Map<String, String> descriptions,
                               Map<String, Map<String, Object>> inputs, String groupKey, String icon) {
        this(id, pageKey, panelId, path, access, defaultAgent, names, descriptions, inputs, groupKey, icon, null, null);
    }
    public ApplicationPanelUse(String id, String pageKey, String panelId, String path, Access access,
                               DefaultAgentTarget defaultAgent, Map<String, String> names,
                               Map<String, String> descriptions,
                               Map<String, Map<String, Object>> inputs, String groupKey, String icon, String kind) {
        this(id, pageKey, panelId, path, access, defaultAgent, names, descriptions, inputs, groupKey, icon, kind, null);
    }

    /** True when this entry points to a built-in native page rather than a product panel. */
    public boolean nativeEntry() {
        return NATIVE_KIND.equals(kind);
    }

    public boolean frameConversationEntry() {
        return FRAME_CONVERSATION_KIND.equals(kind);
    }

    public boolean panelEntry() {
        return kind == null;
    }

    private static final class DescriptionsDeserializer extends JsonDeserializer<Map<String, String>> {
        @Override
        public Map<String, String> deserialize(JsonParser parser, DeserializationContext context) throws IOException {
            var values = context.readTree(parser);
            if (!values.isObject())
                return context.reportInputMismatch(Map.class, "Panel entry descriptions must be an object");
            var descriptions = new LinkedHashMap<String, String>();
            for (var entry : values.properties()) {
                if (!entry.getValue().isTextual())
                    return context.reportInputMismatch(Map.class, "Description for %s must be a string", entry.getKey());
                descriptions.put(entry.getKey(), entry.getValue().textValue());
            }
            return descriptions;
        }

        @Override
        public Map<String, String> getNullValue(DeserializationContext context) throws JsonMappingException {
            return context.reportInputMismatch(Map.class, "Panel entry descriptions must be an object");
        }

        @Override
        public Map<String, String> getAbsentValue(DeserializationContext context) {
            return null;
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Access(String permissionCode, String kind) {}

    public String locator() { return PageSkills.locator(access.permissionCode(), access.kind(), pageKey); }

    static List<ApplicationPanelUse> canonical(List<ApplicationPanelUse> uses) {
        return canonical(uses, false);
    }

    static List<ApplicationPanelUse> canonical(List<ApplicationPanelUse> uses, boolean allowNative) {
        var normalized = uses.stream().map(use -> new ApplicationPanelUse(use.id, use.pageKey, use.panelId,
            canonicalPath(use.path), use.access, use.defaultAgent, use.names, use.descriptions, use.inputs,
            use.groupKey, use.icon, use.kind, use.pageComposer)).toList();
        validate(normalized, allowNative);
        return normalized;
    }

    static String canonicalPath(String path) {
        if (path == null || !path.startsWith("/") || path.contains("//") || path.matches("(?is).*%(2f|5c).*"))
            throw ApplicationCatalog.bad("Panel paths must be complete local paths: " + path);
        if (path.contains("%25"))
            throw ApplicationCatalog.bad("Panel paths cannot contain an encoded percent sign (%25): " + path);
        try {
            var uri = new URI(path);
            var decoded = uri.getPath();
            if (uri.getRawQuery() != null || uri.getRawFragment() != null
                || decoded.codePoints().anyMatch(c -> c == '\\' || Character.isISOControl(c))
                || Arrays.stream(decoded.split("/")).anyMatch(segment -> segment.equals(".") || segment.equals("..")))
                throw ApplicationCatalog.bad("Invalid panel path: " + path);
            if (decoded.length() > 1 && decoded.endsWith("/")) decoded = decoded.substring(0, decoded.length() - 1);
            return UriUtils.encodePath(decoded, StandardCharsets.UTF_8);
        } catch (URISyntaxException error) {
            throw ApplicationCatalog.bad("Invalid panel path: " + path);
        }
    }

    static boolean under(String path, String root) {
        return path.equals(root) || path.startsWith(root.equals("/") ? root : root + "/");
    }

    // Match the shared contract's String.trim() without changing the text we store.
    static boolean blankDescription(String text) {
        return text.codePoints().allMatch(code -> code >= '\t' && code <= '\r' || Character.isSpaceChar(code) || code == 0xfeff);
    }

    public static void validate(List<ApplicationPanelUse> uses) {
        validate(uses, false);
    }

    public static void validate(List<ApplicationPanelUse> uses, boolean allowNative) {
        var ids = new HashSet<String>();
        var pages = new HashSet<String>();
        var paths = new HashSet<String>();
        for (var use : uses) {
            if (use.id() == null || use.id().isBlank() || !ids.add(use.id())
                || use.pageKey() == null || use.pageKey().isBlank() || !pages.add(use.pageKey())
                || !paths.add(use.path())
                || use.access() == null || (use.access().permissionCode() == null) == (use.access().kind() == null)
                || use.access().permissionCode() != null && use.access().permissionCode().isBlank()
                || use.access().kind() != null && !use.access().kind().equals("domain-member"))
                throw ApplicationCatalog.bad("Invalid or duplicate panel use");
            if (use.kind() != null) {
                if (use.nativeEntry() && !allowNative)
                    throw ApplicationCatalog.bad("Native entries are allowed only on built-in applications: " + use.pageKey());
                if (!use.nativeEntry() && !use.frameConversationEntry())
                    throw ApplicationCatalog.bad("Invalid entry kind: " + use.kind());
                if (use.panelId() != null || use.inputs() != null || use.defaultAgent() != null || use.pageComposer() != null)
                    throw ApplicationCatalog.bad(use.kind() + " entry " + use.pageKey() + " cannot declare panelId, inputs, defaultAgent, or pageComposer");
            } else if (use.panelId() == null || use.panelId().isBlank()) {
                throw ApplicationCatalog.bad("Invalid or duplicate panel use");
            }
            if (use.pageComposer() != null
                && !PAGE_COMPOSER_BOTTOM.equals(use.pageComposer())
                && !PAGE_COMPOSER_NONE.equals(use.pageComposer())) {
                throw ApplicationCatalog.bad("Panel entry " + use.pageKey() + " pageComposer must be bottom or none");
            }
            if (use.names() != null && (use.names().isEmpty()
                || use.names().values().stream().anyMatch(name -> name == null || name.isBlank())))
                throw ApplicationCatalog.bad("A panel use's names require at least one nonblank localized name");
            if (use.descriptions() != null && (use.descriptions().isEmpty()
                || use.descriptions().values().stream().anyMatch(text -> text == null || blankDescription(text))))
                throw ApplicationCatalog.bad("Panel entry " + use.pageKey() + " descriptions require at least one nonblank localized description");
            if (use.icon() != null && use.icon().isBlank())
                throw ApplicationCatalog.bad("Panel entry " + use.pageKey() + " icon must be nonblank");
            if (use.inputs() != null) {
                for (var input : use.inputs().entrySet()) {
                    var source = input.getValue();
                    if (input.getKey().isBlank() || source == null || source.size() != 1 ||
                        !(source.containsKey("literal") || source.get("frameState") instanceof String name && !name.isBlank()))
                        throw ApplicationCatalog.bad("Invalid input " + input.getKey() + " on panel entry " + use.pageKey());
                }
            }
        }
    }
}

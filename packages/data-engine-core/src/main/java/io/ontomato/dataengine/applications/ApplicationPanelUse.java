package io.ontomato.dataengine.applications;

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
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApplicationPanelUse(String id, String pageKey, String panelId, String path,
                                  Access access, DefaultAgentTarget defaultAgent, Map<String, String> names,
                                  @JsonDeserialize(using = DescriptionsDeserializer.class) Map<String, String> descriptions,
                                  Map<String, Map<String, Object>> inputs, String groupKey) {
    public ApplicationPanelUse(String id, String pageKey, String panelId, String path, Access access,
                               DefaultAgentTarget defaultAgent, Map<String, String> names) {
        this(id, pageKey, panelId, path, access, defaultAgent, names, null, null, null);
    }
    public ApplicationPanelUse(String id, String pageKey, String panelId, String path, Access access,
                               DefaultAgentTarget defaultAgent, Map<String, String> names,
                               Map<String, Map<String, Object>> inputs, String groupKey) {
        this(id, pageKey, panelId, path, access, defaultAgent, names, null, inputs, groupKey);
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
        var normalized = uses.stream().map(use -> new ApplicationPanelUse(use.id, use.pageKey, use.panelId,
            canonicalPath(use.path), use.access, use.defaultAgent, use.names, use.descriptions, use.inputs, use.groupKey)).toList();
        validate(normalized);
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
        var ids = new HashSet<String>();
        var pages = new HashSet<String>();
        var paths = new HashSet<String>();
        for (var use : uses) {
            if (use.id() == null || use.id().isBlank() || !ids.add(use.id())
                || use.pageKey() == null || use.pageKey().isBlank() || !pages.add(use.pageKey())
                || use.panelId() == null || use.panelId().isBlank()
                || !paths.add(use.path())
                || use.access() == null || (use.access().permissionCode() == null) == (use.access().kind() == null)
                || use.access().permissionCode() != null && use.access().permissionCode().isBlank()
                || use.access().kind() != null && !use.access().kind().equals("domain-member"))
                throw ApplicationCatalog.bad("Invalid or duplicate panel use");
            if (use.names() != null && (use.names().get("en") == null || use.names().get("en").isBlank()
                || use.names().values().stream().anyMatch(name -> name == null || name.isEmpty())))
                throw ApplicationCatalog.bad("A panel use's names require a nonblank English name and nonempty translations");
            if (use.descriptions() != null && (!use.descriptions().containsKey("en")
                || use.descriptions().values().stream().anyMatch(text -> text == null || blankDescription(text))))
                throw ApplicationCatalog.bad("Panel entry " + use.pageKey() + " descriptions require nonblank English text and translations");
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

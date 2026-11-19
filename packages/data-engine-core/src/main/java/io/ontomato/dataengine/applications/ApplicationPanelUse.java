package io.ontomato.dataengine.applications;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.web.util.UriUtils;

/** Java owns entry facts; panels retain only their shared content and manifest. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApplicationPanelUse(String id, String pageKey, String panelId, String path,
                                  Access access, DefaultAgentTarget defaultAgent, Map<String,String> names) {
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Access(String permissionCode, String kind) {}

    public String locator() { return PageSkills.locator(access.permissionCode(), access.kind(), pageKey); }

    static List<ApplicationPanelUse> canonical(List<ApplicationPanelUse> uses) {
        var normalized = uses.stream().map(use -> new ApplicationPanelUse(use.id, use.pageKey, use.panelId,
            canonicalPath(use.path), use.access, use.defaultAgent, use.names)).toList();
        validate(normalized);
        return normalized;
    }

    static String canonicalPath(String path) {
        if (path == null || !path.startsWith("/") || path.contains("//") || path.matches("(?is).*%(2f|5c|25).*"))
            throw ApplicationCatalog.bad("Panel paths must be complete local paths: " + path);
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
        }
    }
}

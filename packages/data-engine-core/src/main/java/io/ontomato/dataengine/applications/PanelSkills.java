package io.ontomato.dataengine.applications;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;

public final class PanelSkills {
    private PanelSkills() {}

    public record Use(String applicationId, String useId, String pageKey, String panelId, String path) {}
    public record Source(PageSkills.Skill skill, List<Use> uses) {}

    record LocatedUse(String applicationId, ApplicationPanelUse use) {
        Use source() { return new Use(applicationId, use.id(), use.pageKey(), use.panelId(), use.path()); }
    }

    /**
     * Names use panel-page or panel-menu, up to 27 characters of the ASCII slug of the page key or menu code,
     * and the first 24 hex digits of SHA-256 over the exact UTF-8 locator. The digest distinguishes case,
     * punctuation, and keys with the same shortened slug. Node consumes this ref from the service catalog.
     */
    static PageSkills.Skill identity(String domainId, ApplicationPanelUse use) {
        var menu = use.access().permissionCode();
        var prefix = menu == null ? "panel-page-" : "panel-menu-";
        var key = menu == null ? use.pageKey() : menu;
        var slug = key.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceFirst("^-", "");
        slug = slug.substring(0, Math.min(27, slug.length())).replaceFirst("-$", "");
        var name = prefix + (slug.isEmpty() ? "" : slug + "-") + digest(use.locator());
        return new PageSkills.Skill(new PageSkills.Namespace("domain", null, domainId), name);
    }

    private static String digest(String locator) {
        try {
            var bytes = MessageDigest.getInstance("SHA-256").digest(locator.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(bytes, 0, 12);
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }
}

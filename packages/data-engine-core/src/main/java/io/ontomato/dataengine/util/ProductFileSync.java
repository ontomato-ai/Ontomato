package io.ontomato.dataengine.util;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Set;

/** Synchronizes product defaults before Spring reads the site's configuration. */
public final class ProductFileSync {
    private static final Set<String> SITE_CONFIG = Set.of("application.yml", "mcp-clients.yml");

    private ProductFileSync() {}

    public static void syncFromEnvironment() throws IOException {
    sync(Path.of(requiredEnvironment("ONTOMATO_CONF_DEFAULTS")), Path.of("."));
    }

    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing " + name + "; start data-engine through its product launcher");
        }
        return value;
    }

  public static void sync(Path confDefaults, Path dataRoot) throws IOException {
        Path conf = dataRoot.resolve("conf");
    for (String name : new String[] {"conf", "logs", "python"}) {
            Files.createDirectories(dataRoot.resolve(name));
        }
        try (var entries = Files.list(confDefaults)) {
            for (Path source : entries.toList()) {
                Path target = conf.resolve(source.getFileName());
                if (SITE_CONFIG.contains(source.getFileName().toString()) && Files.exists(target)) {
                    continue;
                }
                copyInto(source, target);
            }
        }
    System.out.println(
        "[sync] Product defaults synced into "
            + dataRoot.toAbsolutePath().normalize()
            + " (overwrite same names, add new files, keep extras; site configuration only added"
            + " when missing)");
    }

    private static void copyInto(Path source, Path target) throws IOException {
        if (Files.isDirectory(source)) {
            Files.createDirectories(target);
            try (var entries = Files.list(source)) {
                for (Path entry : entries.toList()) {
                    copyInto(entry, target.resolve(entry.getFileName()));
                }
            }
        } else {
            Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.COPY_ATTRIBUTES);
        }
    }
}

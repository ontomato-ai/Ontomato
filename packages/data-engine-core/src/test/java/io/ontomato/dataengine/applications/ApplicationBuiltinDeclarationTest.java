package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.ClassPathResource;

class ApplicationBuiltinDeclarationTest {
    @Test void aDuplicateKeyNamesTheFileAndTheKey() {
        var source = new ByteArrayResource("""
            {"declaration":{"panelUses":[],"panelUses":[]}}
            """.getBytes(StandardCharsets.UTF_8), "applications/duplicate.json");

        var error = assertThrows(IOException.class, () -> ApplicationCatalogUpgrade.Builtins.readDeclaration(source));

        assertTrue(error.getMessage().contains("applications/duplicate.json"));
        assertTrue(error.getMessage().contains("panelUses"));
    }

    @Test void theShippedOntologyDeclarationContainsTheComponentsEntry() throws IOException {
        var ontology = ApplicationCatalogUpgrade.Builtins.readDeclaration(new ClassPathResource("applications/ontology.json"));

        var components = ontology.declaration().panelUses().stream()
            .filter(use -> use.path().equals("/ontology/components"))
            .findFirst().orElseThrow();
        assertEquals("builtin-product-sdk-components", components.panelId());
        assertEquals("ontology-modeling", components.access().permissionCode());
    }
}

package io.ontomato.dataengine.service.authorization;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

@Component
final class WorkbenchManagementOperations implements ManagementOperations.Contributor {
    private record Declaration(String id, String access) {}

    private final List<ManagementOperations.Operation> operations;

    WorkbenchManagementOperations(ObjectMapper mapper) throws IOException {
        try (var input = new ClassPathResource("ontology-contracts/workbench-management-operations.json").getInputStream()) {
            var declarations = mapper.readValue(input, new TypeReference<Map<String, Declaration>>() {});
            operations = declarations.values().stream()
                .map(entry -> new ManagementOperations.Operation(entry.id(),
                    ManagementOperations.Access.valueOf(entry.access().toUpperCase(Locale.ROOT))))
                .toList();
        }
    }

    @Override
    public Collection<ManagementOperations.Operation> managementOperations() {
        return operations;
    }
}

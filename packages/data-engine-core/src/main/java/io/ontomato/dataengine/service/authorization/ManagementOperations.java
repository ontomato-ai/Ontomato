package io.ontomato.dataengine.service.authorization;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public final class ManagementOperations {
    public enum Access { READ, CHANGE }
    public record Operation(String id, String name, Access access) {
        public Operation {
            if (name == null || name.isBlank()) {
                throw new IllegalArgumentException("Management operation name is required: " + id);
            }
        }
    }

    public interface Contributor {
        Collection<Operation> managementOperations();
    }

    private final Map<String, Operation> operations;

    public ManagementOperations(List<Contributor> contributors) {
        var catalog = new LinkedHashMap<String, Operation>();
        for (var contributor : contributors) {
            for (var operation : contributor.managementOperations()) {
                if (catalog.putIfAbsent(operation.id(), operation) != null)
                    throw new IllegalStateException("Management operation registered twice: " + operation.id());
            }
        }
        operations = Map.copyOf(catalog);
    }

    public Operation require(String operationId) {
        var operation = operations.get(operationId);
        if (operation == null) throw new IllegalArgumentException("Unknown management operation: " + operationId);
        return operation;
    }

    public List<Operation> list() {
        return operations.values().stream().sorted(java.util.Comparator.comparing(Operation::id)).toList();
    }
}

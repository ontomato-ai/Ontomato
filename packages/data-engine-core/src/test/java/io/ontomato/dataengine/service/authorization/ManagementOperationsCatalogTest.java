package io.ontomato.dataengine.service.authorization;

import static org.junit.jupiter.api.Assertions.assertFalse;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.ClassPathBeanDefinitionScanner;
import org.springframework.core.type.filter.AssignableTypeFilter;

class ManagementOperationsCatalogTest {
    @Test
    void everyRegisteredOperationHasANameAndGroup() {
        try (var context = new AnnotationConfigApplicationContext()) {
            var scanner = new ClassPathBeanDefinitionScanner(context, false);
            scanner.addIncludeFilter(new AssignableTypeFilter(ManagementOperations.Contributor.class));
            scanner.scan("io.ontomato.dataengine");
            context.registerBean(ObjectMapper.class, () -> new ObjectMapper());
            context.register(ManagementOperations.class);
            context.refresh();

            var operations = context.getBean(ManagementOperations.class).list();
            assertFalse(operations.isEmpty(), "Management operation catalog is empty");
            for (var operation : operations) {
                assertFalse(operation.name().isBlank(), operation.id() + " has no name");
                assertFalse(operation.group().isBlank(), operation.id() + " has no group");
            }
        }
    }
}

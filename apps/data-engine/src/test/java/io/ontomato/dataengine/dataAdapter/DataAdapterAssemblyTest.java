package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import io.ontomato.dataengine.config.DataRagConfig;

/** The app pom's adapter modules are what the registry reports. */
class DataAdapterAssemblyTest {

	@Test
	void theOpenSourceEditionInstallsItsAdapters() {
		try (AnnotationConfigApplicationContext ctx = new AnnotationConfigApplicationContext()) {
			ctx.register(DataRagConfig.class);
			ctx.scan("io.ontomato.dataengine.dataAdapter");
			ctx.refresh();
			List<DataAdapterProvider> installed = ctx.getBean(DataAdapterRegistry.class).installed();
			assertTrue(installed.stream().map(DataAdapterProvider::type).toList()
					.containsAll(List.of("duckdb", "elasticsearch", "multi", "mysql", "neo4j", "opensearch", "postgresql",
							"sqlserver")),
					installed.stream().map(DataAdapterProvider::type).toList().toString());
		}
	}
}

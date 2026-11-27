package io.ontomato.dataengine.panelreads;

import static io.ontomato.dataengine.panelreads.WorkbenchPanelRead.QueryExecution.METADATA;

import io.ontomato.dataengine.service.BuildTestException;
import io.ontomato.dataengine.service.DataSandboxService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;

@Configuration(proxyBeanMethods = false)
class WorkbenchBuildTestMetadata {
    @Bean
    WorkbenchPanelRead.Query workbenchBuilderTestStatus(DataSandboxService sandboxes) {
        return new WorkbenchPanelRead.Query("platform:Application", "builderTestStatus", METADATA, (access, call, language) -> {
            if (!(call.get("workspaceId") instanceof String workspace) || workspace.isBlank())
                throw new BuildTestException(HttpStatus.BAD_REQUEST, "BUILD_TEST_SAMPLE_INVALID: workspaceId required");
            return sandboxes.currentStatusFact(workspace, access);
        });
    }
}

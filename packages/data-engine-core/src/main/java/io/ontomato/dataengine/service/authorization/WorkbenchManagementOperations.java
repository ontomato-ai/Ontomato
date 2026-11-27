package io.ontomato.dataengine.service.authorization;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.panelreads.WorkbenchPanelRead;
import java.io.IOException;
import java.util.Collection;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.context.annotation.Bean;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

@Component
final class WorkbenchManagementOperations implements ManagementOperations.Contributor {
    private record Declaration(String id, String name, String access) {}

    private final Map<String, ManagementOperations.Operation> operations;

    WorkbenchManagementOperations(ObjectMapper mapper) throws IOException {
        try (var input = new ClassPathResource("ontology-contracts/workbench-management-operations.json").getInputStream()) {
            var declarations = mapper.readValue(input, new TypeReference<Map<String, Declaration>>() {});
            operations = declarations.entrySet().stream().collect(Collectors.toUnmodifiableMap(Map.Entry::getKey, entry -> {
                var declaration = entry.getValue();
                return new ManagementOperations.Operation(declaration.id(), declaration.name(),
                    ManagementOperations.Access.valueOf(declaration.access().toUpperCase(Locale.ROOT)));
            }));
        }
    }

    @Bean
    WorkbenchPanelRead feedbackPanelQuery(ManagementRequestAccess management) {
        return managementRead("platform:FeedbackRecord", "query", "feedbackRead", management);
    }

    @Bean
    WorkbenchPanelRead feedbackPanelCounts(ManagementRequestAccess management) {
        return managementRead("platform:FeedbackRecord", "counts", "feedbackRead", management);
    }

    @Bean
    WorkbenchPanelRead feedbackPanelRecord(ManagementRequestAccess management) {
        return managementRead("platform:FeedbackRecord", "record", "feedbackRead", management);
    }

    @Bean
    WorkbenchPanelRead publishedMcpPanelList(ManagementRequestAccess management) {
        return managementRead("platform:PublishedMcpService", "list", "publishedMcpRead", management);
    }

    @Bean
    WorkbenchPanelRead publishedMcpPanelRecord(ManagementRequestAccess management) {
        return managementRead("platform:PublishedMcpService", "record", "publishedMcpRead", management);
    }

    @Bean
    WorkbenchPanelRead publishedMcpPanelTools(ManagementRequestAccess management) {
        return managementRead("platform:PublishedMcpService", "tools", "publishedMcpRead", management);
    }

    @Bean
    WorkbenchPanelRead externalMcpPanelList(ManagementRequestAccess management) {
        return managementRead("platform:ExternalMcpService", "list", "mcpServicesRead", management);
    }

    @Bean
    WorkbenchPanelRead externalMcpPanelRecord(ManagementRequestAccess management) {
        return managementRead("platform:ExternalMcpService", "record", "mcpServicesRead", management);
    }

    @Bean
    WorkbenchPanelRead externalMcpPanelForm(ManagementRequestAccess management) {
        return managementRead("platform:ExternalMcpService", "form", "mcpServicesRead", management);
    }

    @Bean
    WorkbenchPanelRead externalMcpPanelCreateForm(ManagementRequestAccess management) {
        return managementRead("platform:ExternalMcpService", "createForm", "mcpServicesRead", management);
    }

    @Bean
    WorkbenchPanelRead externalMcpPanelTools(ManagementRequestAccess management) {
        return managementRead("platform:ExternalMcpService", "tools", "mcpServicesRead", management);
    }

    @Bean
    WorkbenchPanelRead objectDetailPanelAccess(AuthorizationService authorization) {
        var operation = new AuthorizationService.Management(operations.get("objectDetailsChange").id());
        return new WorkbenchPanelRead("platform:ObjectType", "detailPanel",
            (subject, parameters) -> authorization.decide(subject, operation).allowed());
    }

    @Bean
    WorkbenchPanelRead triggerApplicationLabelAccess(AuthorizationService authorization) {
        var inspection = new AuthorizationService.Management(operations.get("opsInspectionRead").id());
        var caseSets = new AuthorizationService.Management(operations.get("opsCaseSetsRead").id());
        return new WorkbenchPanelRead("platform:Trigger", "applicationLabelAccess", (subject, parameters) -> Map.of(
            "inspection", authorization.decide(subject, inspection), "caseSets", authorization.decide(subject, caseSets)));
    }

    @Bean
    WorkbenchPanelRead opsKnowledgeFiles(ManagementRequestAccess management) {
        return managementRead("platform:OpsKnowledge", "files", "opsKnowledgeRead", management);
    }

    @Bean
    WorkbenchPanelRead opsKnowledgeRecord(ManagementRequestAccess management) {
        return managementRead("platform:OpsKnowledge", "record", "opsKnowledgeRead", management);
    }

    @Bean
    WorkbenchPanelRead dslQueryForm(ManagementRequestAccess management) {
        return managementRead("platform:DslQuery", "form", "opsDslRead", management);
    }

    @Bean
    WorkbenchPanelRead turnEvidenceList(ManagementRequestAccess management) {
        return managementRead("platform:TurnEvidence", "list", "opsTurnEvidenceRead", management);
    }

    @Bean
    WorkbenchPanelRead turnEvidenceRecord(ManagementRequestAccess management) {
        return managementRead("platform:TurnEvidence", "record", "opsTurnEvidenceRead", management);
    }

    @Bean
    WorkbenchPanelRead turnEvidenceEvidenceRuns(ManagementRequestAccess management) {
        return managementRead("platform:TurnEvidence", "evidenceRuns", "opsTurnEvidenceRead", management);
    }

    @Bean
    WorkbenchPanelRead turnEvidenceEvidenceGaps(ManagementRequestAccess management) {
        return managementRead("platform:TurnEvidence", "evidenceGaps", "opsTurnEvidenceRead", management);
    }

    @Bean
    WorkbenchPanelRead turnEvidenceFiles(ManagementRequestAccess management) {
        return managementRead("platform:TurnEvidence", "files", "opsTurnEvidenceRead", management);
    }

    @Bean
    WorkbenchPanelRead turnEvidenceFile(ManagementRequestAccess management) {
        return managementRead("platform:TurnEvidence", "file", "opsTurnEvidenceRead", management);
    }

    @Bean
    WorkbenchPanelRead autotestCaseSetList(ManagementRequestAccess management) {
        return managementRead("platform:AutotestCaseSet", "list", "opsCaseSetsRead", management);
    }

    @Bean
    WorkbenchPanelRead autotestCaseSetRecord(ManagementRequestAccess management) {
        return managementRead("platform:AutotestCaseSet", "record", "opsCaseSetsRead", management);
    }

    @Bean
    WorkbenchPanelRead autotestCaseSetForm(ManagementRequestAccess management) {
        return managementRead("platform:AutotestCaseSet", "form", "opsCaseSetsRead", management);
    }

    @Bean
    WorkbenchPanelRead autotestRunList(ManagementRequestAccess management) {
        return managementRead("platform:AutotestRun", "list", "opsRunsRead", management);
    }

    @Bean
    WorkbenchPanelRead autotestRunRecord(ManagementRequestAccess management) {
        return managementRead("platform:AutotestRun", "record", "opsRunsRead", management);
    }

    @Bean
    WorkbenchPanelRead autotestRunResults(ManagementRequestAccess management) {
        return managementRead("platform:AutotestRun", "results", "opsRunsRead", management);
    }

    @Bean
    WorkbenchPanelRead autotestCaseArtifactRecord(ManagementRequestAccess management) {
        return managementRead("platform:AutotestCaseArtifact", "record", "opsRunsRead", management);
    }

    @Bean
    WorkbenchPanelRead autotestCaseArtifactEvidenceRuns(ManagementRequestAccess management) {
        return managementRead("platform:AutotestCaseArtifact", "evidenceRuns", "opsRunsRead", management);
    }

    @Bean
    WorkbenchPanelRead autotestCaseArtifactEvidenceGaps(ManagementRequestAccess management) {
        return managementRead("platform:AutotestCaseArtifact", "evidenceGaps", "opsRunsRead", management);
    }

    @Bean
    WorkbenchPanelRead autotestCaseArtifactFiles(ManagementRequestAccess management) {
        return managementRead("platform:AutotestCaseArtifact", "files", "opsRunsRead", management);
    }

    @Bean
    WorkbenchPanelRead autotestCaseArtifactFile(ManagementRequestAccess management) {
        return managementRead("platform:AutotestCaseArtifact", "file", "opsRunsRead", management);
    }

    private WorkbenchPanelRead managementRead(String type, String name, String operation, ManagementRequestAccess management) {
        String operationId = operations.get(operation).id();
        return new WorkbenchPanelRead(type, name, (subject, parameters) -> {
            management.require(subject, operationId);
            return operationId;
        });
    }

    @Override
    public Collection<ManagementOperations.Operation> managementOperations() {
        return operations.values();
    }
}

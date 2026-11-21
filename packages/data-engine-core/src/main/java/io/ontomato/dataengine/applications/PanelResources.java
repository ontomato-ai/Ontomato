package io.ontomato.dataengine.applications;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;

/** Node owns current panel identities; Java owns the application and its permissions. */
@Component
public class PanelResources {
    private final RestClient http;
    public PanelResources(
        @Value("${WORKBENCH_INTERNAL_URL:${AGENT_RUNTIME_CALLBACK_URL:http://127.0.0.1:3000}}") String url,
        @Value("${ONTOMATO_QUERY_SERVICE_TOKEN:}") String token) {
        var requests = new org.springframework.http.client.SimpleClientHttpRequestFactory();
        requests.setConnectTimeout(5000); requests.setReadTimeout(30000);
        http = RestClient.builder().requestFactory(requests).baseUrl(url)
            .defaultHeader("X-Ontomato-Query-Service-Token", token).build();
    }
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private record UseReference(String id, String panelId, Map<String, Map<String, Object>> inputs,
                                DefaultAgentTarget defaultAgent) {}
    private record DeliveryReferences(List<String> panels, List<String> projections) {}
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private record References(String domainId, String framePanelId, List<UseReference> uses, DeliveryReferences delivery,
                              JsonNode theme) {}

    public void requireCurrent(String domain, String framePanelId, List<ApplicationPanelUse> uses,
                               ApplicationCatalog.Delivery delivery, JsonNode theme) {
        var references = new References(domain, framePanelId,
            uses.stream().map(use -> new UseReference(use.id(), use.panelId(), use.inputs(), use.defaultAgent())).toList(),
            delivery == null ? new DeliveryReferences(List.of(), List.of())
                : new DeliveryReferences(delivery.panels(), delivery.projections()), theme);
        try {
            http.post().uri("/internal/product-panels/validate-references").contentType(MediaType.APPLICATION_JSON)
                .body(references).retrieve().toBodilessEntity();
        } catch (RestClientResponseException failure) {
            throw new ResponseStatusException(failure.getStatusCode(), failure.getResponseBodyAsString(), failure);
        }
    }

    public String objectDetailPanel(String domainId, String className) {
        try {
            var response = http.get().uri(builder -> builder.path("/internal/object-details/resolve")
                .queryParam("domainId", "{domainId}").queryParam("className", "{className}")
                .build(domainId, className))
                .retrieve().body(JsonNode.class);
            var panelId = response == null ? null : response.get("panelId");
            if (panelId == null || (!panelId.isNull() && (!panelId.isTextual() || panelId.asText().isBlank())))
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Invalid object detail mapping response");
            return panelId.isNull() ? null : panelId.asText();
        } catch (RestClientResponseException failure) {
            throw new ResponseStatusException(failure.getStatusCode(), failure.getResponseBodyAsString(), failure);
        }
    }
}

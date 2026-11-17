package io.ontomato.dataengine.applications;

import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
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
    public void requireCurrent(String domain, List<String> ids) {
        try {
            http.post().uri("/internal/product-panels/validate-references")
                .body(Map.of("domainId", domain, "ids", ids)).retrieve().toBodilessEntity();
        } catch (RestClientResponseException failure) {
            throw new ResponseStatusException(failure.getStatusCode(), failure.getResponseBodyAsString(), failure);
        }
    }
}

package io.ontomato.dataengine.service.agent;

import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class AgentPresetsClient {
    private final RestClient workbench;

    public AgentPresetsClient(
            @Value("${WORKBENCH_INTERNAL_URL:${AGENT_RUNTIME_CALLBACK_URL:http://127.0.0.1:3000}}") String url,
            @Value("${ONTOMATO_QUERY_SERVICE_TOKEN:}") String token) {
        var requests = new SimpleClientHttpRequestFactory();
        requests.setConnectTimeout(5000);
        requests.setReadTimeout(30000);
        workbench = RestClient.builder().requestFactory(requests).baseUrl(url)
                .defaultHeader(WorkbenchServiceAuthentication.HEADER, token).build();
    }

    public void initialize(String domainId) {
        workbench.post().uri("/internal/assistant/domains/{domainId}/initialize-presets", domainId)
                .retrieve().toBodilessEntity();
    }
}

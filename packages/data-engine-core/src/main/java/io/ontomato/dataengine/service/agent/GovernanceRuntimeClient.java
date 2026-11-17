package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.JSONObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/** Reads workbench-owned runtime facts without using the ontology runtime identity. */
@Component
public class GovernanceRuntimeClient {
  private final RestClient http;

  public GovernanceRuntimeClient(
      @Value("${WORKBENCH_INTERNAL_URL:${AGENT_RUNTIME_CALLBACK_URL:http://127.0.0.1:3000}}") String url,
      @Value("${ONTOMATO_QUERY_SERVICE_TOKEN:}") String token) {
    var requests = new org.springframework.http.client.SimpleClientHttpRequestFactory();
    requests.setConnectTimeout(5000);
    requests.setReadTimeout(30000);
    http = RestClient.builder().requestFactory(requests).baseUrl(url)
        .defaultHeader("X-Ontomato-Query-Service-Token", token).build();
  }

  public JSONObject status(String domain, String session, String run) {
    return JSONObject.parseObject(http.get()
        .uri("/internal/assistant/sessions/" + session + "/runs/" + run + "/status")
        .header("X-Domain-Id", domain).retrieve().body(String.class));
  }
}

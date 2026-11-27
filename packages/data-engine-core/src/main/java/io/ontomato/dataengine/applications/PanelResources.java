package io.ontomato.dataengine.applications;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import io.ontomato.dataengine.service.DataSandboxService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.QueryGrantService;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;

/** Node owns current panel identities; Java owns the application and its permissions. */
@Component
public class PanelResources {
    static final String DEFAULT_AGENT_UNAVAILABLE = "PAGE_DEFAULT_AGENT_UNAVAILABLE";

    static final class DefaultAgentRefusal extends ResponseStatusException {
        private final String field;

        DefaultAgentRefusal(int index, String message, RestClientResponseException cause) {
            super(HttpStatus.CONFLICT, message, cause);
            field = "/values/panelUses/" + index + "/defaultAgent";
        }

        String field() {
            return field;
        }
    }

    private final RestClient http;
    private final IdentityService identity;
    @Autowired
    public PanelResources(
        @Value("${WORKBENCH_INTERNAL_URL:${AGENT_RUNTIME_CALLBACK_URL:http://127.0.0.1:3000}}") String url,
        @Value("${ONTOMATO_QUERY_SERVICE_TOKEN:}") String token, IdentityService identity) {
        this(client(url, token), identity);
    }

    PanelResources(RestClient http, IdentityService identity) {
        this.http = http;
        this.identity = identity;
    }

    private static RestClient client(String url, String token) {
        var requests = new org.springframework.http.client.SimpleClientHttpRequestFactory();
        requests.setConnectTimeout(5000); requests.setReadTimeout(30000);
        return RestClient.builder().requestFactory(requests).baseUrl(url)
            .defaultHeader("X-Ontomato-Query-Service-Token", token).build();
    }
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private record UseReference(String id, String panelId, Map<String, Map<String, Object>> inputs,
                                DefaultAgentTarget defaultAgent, String icon, String pageComposer) {}
    private record DeliveryReferences(List<String> panels, List<String> projections) {}
    private record IconReference(String kind, String domainId, String icon) {}
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private record References(String domainId, String framePanelId, List<UseReference> uses, List<String> frameConversationEntryIds, DeliveryReferences delivery,
                              JsonNode theme, String icon) {}

    public void requireCurrent(String domain, String framePanelId, List<ApplicationPanelUse> uses,
                               ApplicationCatalog.Delivery delivery, JsonNode theme, String icon, Locale locale) {
        if (framePanelId != null || !uses.isEmpty() || delivery != null || theme != null)
            throw new IllegalArgumentException("Only an application icon can be checked without a registrant");
        if (icon != null) submit(new IconReference("icon", domain, icon), List.of(), new HttpHeaders(), locale);
    }

    /** Requires the current Java registrant to be able to use each declared root and the application frame. */
    public void requireUsableRegistration(String domain, String framePanelId, List<ApplicationPanelUse> uses,
                                          ApplicationCatalog.Delivery delivery, JsonNode theme, String icon, Locale locale) {
        var headers = registrationHeaders(domain);
        var references = new References(domain, framePanelId,
            uses.stream().filter(ApplicationPanelUse::panelEntry).map(use -> new UseReference(use.id(), use.panelId(), use.inputs(), use.defaultAgent(), use.icon(), use.pageComposer())).toList(),
            uses.stream().filter(ApplicationPanelUse::frameConversationEntry).map(ApplicationPanelUse::id).toList(),
            delivery == null ? new DeliveryReferences(List.of(), List.of())
                : new DeliveryReferences(delivery.panels(), delivery.projections()), theme, icon);
        submit(references, uses, headers, locale);
    }

    private HttpHeaders registrationHeaders(String domain) {
        var user = identity.getCurrentUser();
        if (user == null || !user.isEnable() || !(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes))
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "An authenticated registration request is required");
        if (!domain.equals(user.getDomainId()))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Application registration must be in the registrant's domain");
        var servlet = attributes.getRequest();
        if (servlet.getAttribute(QueryGrantService.ATTRIBUTE) != null)
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "The current credential cannot register an application");

        var headers = new HttpHeaders();
        headers.set("X-Ontomato-Application-Registrant", identity.workbenchSubjectId(user));
        var token = servlet.getParameter("tk");
        if (token == null || token.isEmpty()) token = servlet.getHeader("tk");
        if (token != null) headers.set("tk", token);
        for (var name : List.of("X-API-Key", "X-Ontomato-Retrieval-Caller-Id", "X-Ontomato-Agent-Execution")) {
            var value = servlet.getHeader(name);
            if (value != null) headers.set(name, value);
        }
        return headers;
    }

    private void submit(Object references, List<ApplicationPanelUse> uses, HttpHeaders headers, Locale locale) {
        try {
            var request = http.post().uri("/internal/product-panels/validate-references").contentType(MediaType.APPLICATION_JSON)
                .headers(outgoing -> outgoing.addAll(headers));
            if (locale != null) request.header(HttpHeaders.ACCEPT_LANGUAGE, locale.toLanguageTag());
            request.body(references).retrieve().toBodilessEntity();
        } catch (RestClientResponseException failure) {
            var responseHeaders = failure.getResponseHeaders();
            var contentType = responseHeaders == null ? null : responseHeaders.getContentType();
            if (failure.getStatusCode().value() == HttpStatus.CONFLICT.value()
                && contentType != null && MediaType.APPLICATION_JSON.isCompatibleWith(contentType)) {
                var body = failure.getResponseBodyAs(JsonNode.class);
                if (body != null) {
                    var error = body.path("error");
                    if (DEFAULT_AGENT_UNAVAILABLE.equals(error.path("code").asText())) {
                        var useId = body.path("details").path("useId").textValue();
                        for (int i = 0; i < uses.size(); i++)
                            if (uses.get(i).id().equals(useId))
                                throw new DefaultAgentRefusal(i, error.path("message").asText(), failure);
                    }
                }
            }
            throw new ResponseStatusException(failure.getStatusCode(), failure.getResponseBodyAsString(), failure);
        }
    }
}

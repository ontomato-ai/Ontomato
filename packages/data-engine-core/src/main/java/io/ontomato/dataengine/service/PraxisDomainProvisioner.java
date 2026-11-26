package io.ontomato.dataengine.service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSONObject;

import lombok.extern.slf4j.Slf4j;

/**
 * Opens the corresponding Praxis ledger after Ontomato creates a domain.
 *
 * <p>The call is asynchronous and idempotent. A Praxis outage must not roll back an already
 * created platform domain; operators can replay the same internal provisioning request.</p>
 */
@Slf4j
@Service
public class PraxisDomainProvisioner {

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();

    public void provisionAsync(String domainId, String adminLoginCode) {
        String base = trim(environment("ONTOPRAXIS_BASE_URL"));
        String token = trim(environment("ONTOPRAXIS_ADMIN_TOKEN"));
        if (base == null || token == null) {
            log.debug("Praxis domain provisioning is disabled");
            return;
        }
        Thread.startVirtualThread(() -> provision(base, token, domainId, adminLoginCode));
    }

    HttpRequest buildRequest(String base, String token, String domainId, String adminLoginCode) {
        String encodedDomain = URLEncoder.encode(domainId, StandardCharsets.UTF_8).replace("+", "%20");
        return HttpRequest.newBuilder(
                        URI.create(base.replaceAll("/+$", "") + "/internal/domains/" + encodedDomain))
                .timeout(Duration.ofSeconds(60))
                .header("content-type", "application/json")
                .header("x-ontopraxis-admin-token", token)
                .PUT(HttpRequest.BodyPublishers.ofString(buildBody(adminLoginCode).toJSONString()))
                .build();
    }

    JSONObject buildBody(String adminLoginCode) {
        var body = new JSONObject();
        body.put("loginCode", adminLoginCode);
        body.put("password", "admin");
        body.put("executorFallback", "deny");
        return body;
    }

    private void provision(String base, String token, String domainId, String adminLoginCode) {
        String lastError = null;
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                var response = http.send(
                        buildRequest(base, token, domainId, adminLoginCode),
                        HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() >= 200 && response.statusCode() < 300) {
                    log.info("Praxis provisioned domain {}", domainId);
                    return;
                }
                lastError = response.statusCode() + " " + abbreviate(response.body());
                if (response.statusCode() < 500) break;
            } catch (Exception error) {
                lastError = error.getMessage();
            }
            if (attempt < 3) {
                try {
                    Thread.sleep(1_000L << (attempt - 1));
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
        log.warn("Praxis could not provision domain {}: {}", domainId, lastError);
    }

    private static String environment(String name) {
        return System.getenv(name);
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String abbreviate(String value) {
        if (value == null) return "";
        return value.length() <= 500 ? value : value.substring(0, 500);
    }
}

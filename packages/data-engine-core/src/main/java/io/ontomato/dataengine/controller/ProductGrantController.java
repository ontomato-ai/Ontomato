package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.applications.ApplicationCatalog;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.ProductGrantService;
import io.ontomato.dataengine.service.ProductGrants;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class ProductGrantController {
    public static final String UNREGISTER_PATH="/product-governance/unregister";
    public static final String REGISTER_PATH="/product-governance/register";
    public static final String SERVICE_RESOURCES_PATH="/product-governance/service-resources";
    private final ProductGrantService grants;
    private final WorkbenchServiceAuthentication authentication;
    private final ApplicationCatalog applications;
    private final IdentityService identity;

    public ProductGrantController(ProductGrantService grants, WorkbenchServiceAuthentication authentication,
            ApplicationCatalog applications, IdentityService identity) {
        this.grants = grants;
        this.authentication = authentication;
        this.applications = applications;
        this.identity = identity;
    }
    @PostMapping("/product-governance/check")
    public Object check(@RequestBody Map<String, Object> body) {
        if (body.containsKey("target") || body.containsKey("ownerFacts"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Object definitions use the authorization decision endpoint.");
        return Map.of("allowed", grants.allowed(text(body, "id"), text(body, "verb")));
    }
    @PostMapping("/product-governance/check-batch")
    public Object checkBatch(@RequestBody Map<String, Object> body) {
        if (!(body.get("ids") instanceof List<?> values) || values.isEmpty() || values.size() > 200)
            throw new IllegalArgumentException("Expected 1 to 200 product ids");
        var ids = new ArrayList<String>(values.size());
        for (Object value : values) {
            if (!(value instanceof String id) || id.isBlank())
                throw new IllegalArgumentException("Expected non-blank product id");
            ids.add(id);
        }
        return Map.of("allowed", grants.allowedBatch(ids, text(body, "verb")));
    }
    @PostMapping("/product-governance/resources") public Object resources(@RequestBody Map<String,Object> body){return Map.of("ids",grants.resources(text(body,"verb")));}
    @PostMapping("/product-governance/grants") public Object grants(@RequestBody Map<String,Object> body){return Map.of("grants",grants.grantViews(text(body,"id")));}
    @PostMapping("/product-governance/principals") public Object principals(@RequestBody Map<String,Object> body){
        String kind = text(body, "kind");
        String keyword = body.get("keyword") instanceof String value ? value : "";
        int limit = body.get("limit") instanceof Number value ? value.intValue() : 50;
        return Map.of("options", grants.searchPrincipals(kind, keyword, limit));
    }
    @PostMapping(SERVICE_RESOURCES_PATH) public Object serviceResources(HttpServletRequest request,@RequestBody Map<String,Object> body){authentication.authenticate(request);return Map.of("ids",grants.resourcesFor(text(body,"domainId"),text(body,"userId"),text(body,"verb")));}
    @PostMapping("/product-governance/share")
    public Object share(@RequestBody Map<String, Object> body) {
        if (!(body.get("shared") instanceof Boolean shared)) throw new IllegalArgumentException("Expected sharing intent");
        String id = text(body, "id");
        requireLegacyGrantChange(id);
        grants.share(id, shared);
        return Map.of("success", true);
    }
    @PostMapping(REGISTER_PATH) public Object register(HttpServletRequest request,@RequestBody Map<String,Object> body){
        authentication.authenticate(request);
        if(!(body.get("shared") instanceof Boolean shared))throw new IllegalArgumentException("Expected sharing intent");
        Object admin = body.getOrDefault("grantAdmin", false);
        if (!(admin instanceof Boolean grantAdmin)) throw new IllegalArgumentException("Expected grantAdmin");
        if (!(body.getOrDefault("createOnly", false) instanceof Boolean createOnly))
            throw new IllegalArgumentException("Expected createOnly");
        boolean created = grants.register(text(body, "domainId"), text(body, "id"), optionalText(body, "ownerId"), shared,
            body.get("verbs") == null ? List.of() : verbs(body), grantAdmin, optionalText(body, "legacyMenuPermission"));
        if (createOnly && !created)
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Product identity is already registered");
        return Map.of("success", true);
    }
    @PostMapping(UNREGISTER_PATH)
    public Object unregister(HttpServletRequest request, @RequestBody Map<String,Object> body) {
        authentication.authenticate(request);
        grants.unregister(text(body, "domainId"), text(body, "id"));
        return Map.of("success", true);
    }

    @PostMapping("/product-governance/grant") public Object grant(@RequestBody Map<String,Object> body){
        if(!(body.get("remove") instanceof Boolean remove))throw new IllegalArgumentException("Expected removal intent");
        String id = text(body, "id");
        var grant = new ProductGrants.Grant(text(body, "principalKind"), text(body, "principalId"), text(body, "verb"));
        requireLegacyGrantChange(id);
        grants.grant(id, grant, remove);
        return Map.of("success", true);
    }
    @PostMapping("/product-governance/grant-set")
    public Object setGrants(@RequestBody Map<String, Object> body) {
        String id = text(body, "id");
        var kind = text(body, "principalKind");
        var principal = text(body, "principalId");
        var requested = verbs(body);
        requireLegacyGrantChange(id);
        grants.setGrants(id, kind, principal, requested);
        return Map.of("success", true);
    }

    @PostMapping("/product-governance/domain-grants")
    public Object domainGrants(@RequestBody(required = false) Map<String, Object> body) {
        var filter = body == null ? Map.<String, Object>of() : body;
        return Map.of("grants", grants.domainGrants(optionalText(filter, "principalKind"), optionalText(filter, "principalId")));
    }

    private void requireLegacyGrantChange(String id) {
        var user = identity.getCurrentUser();
        if (user != null && user.getDomainId() != null) applications.requireLegacyGrantChange(id, user);
    }

    private static List<String> verbs(Map<String, Object> body) {
        if (!(body.get("verbs") instanceof List<?> values)) throw new IllegalArgumentException("Expected verbs");
        var verbs = new ArrayList<String>(values.size());
        for (Object value : values) {
            if (!(value instanceof String verb)) throw new IllegalArgumentException("Expected verb");
            verbs.add(verb);
        }
        return verbs;
    }

    private static String optionalText(Map<?, ?> body, String key) {
        Object value = body.get(key);
        if (value == null) return null;
        if (value instanceof String text) return text;
        throw new IllegalArgumentException("Expected " + key);
    }

    private static String text(Map<?, ?> body,String key){if(!(body.get(key) instanceof String value)||value.isBlank())throw new IllegalArgumentException("Expected "+key);return value;}
}

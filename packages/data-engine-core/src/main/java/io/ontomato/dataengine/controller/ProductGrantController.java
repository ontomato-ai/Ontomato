package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.ProductGrantService;
import io.ontomato.dataengine.service.ProductGrants;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
public class ProductGrantController {
    public static final String UNREGISTER_PATH="/product-governance/unregister";
    public static final String REGISTER_PATH="/product-governance/register";
    public static final String SERVICE_RESOURCES_PATH="/product-governance/service-resources";
    private final ProductGrantService grants;
    private final WorkbenchServiceAuthentication authentication;
    public ProductGrantController(ProductGrantService grants,WorkbenchServiceAuthentication authentication){this.grants=grants;this.authentication=authentication;}
    @PostMapping("/product-governance/check") public Object check(@RequestBody Map<String,Object> body){return Map.of("allowed",grants.allowed(text(body,"id"),text(body,"verb")));}
    @PostMapping("/product-governance/resources") public Object resources(@RequestBody Map<String,Object> body){return Map.of("ids",grants.resources(text(body,"verb")));}
    @PostMapping("/product-governance/grants") public Object grants(@RequestBody Map<String,Object> body){return Map.of("grants",grants.grantViews(text(body,"id")));}
    @PostMapping("/product-governance/principals") public Object principals(@RequestBody Map<String,Object> body){
        String kind = text(body, "kind");
        String keyword = body.get("keyword") instanceof String value ? value : "";
        int limit = body.get("limit") instanceof Number value ? value.intValue() : 50;
        return Map.of("options", grants.searchPrincipals(kind, keyword, limit));
    }
    @PostMapping(SERVICE_RESOURCES_PATH) public Object serviceResources(HttpServletRequest request,@RequestBody Map<String,Object> body){authentication.authenticate(request);return Map.of("ids",grants.resourcesFor(text(body,"domainId"),text(body,"userId"),text(body,"verb")));}
    @PostMapping("/product-governance/share") public Object share(@RequestBody Map<String,Object> body){if(!(body.get("shared") instanceof Boolean shared))throw new IllegalArgumentException("Expected sharing intent");grants.share(text(body,"id"),shared);return Map.of("success",true);}
    @PostMapping(REGISTER_PATH) public Object register(HttpServletRequest request,@RequestBody Map<String,Object> body){
        authentication.authenticate(request);
        if(!(body.get("shared") instanceof Boolean shared))throw new IllegalArgumentException("Expected sharing intent");
        grants.register(text(body,"domainId"),text(body,"id"),text(body,"ownerId"),shared);return Map.of("success",true);
    }
    @PostMapping(UNREGISTER_PATH)
    public Object unregister(HttpServletRequest request, @RequestBody Map<String,Object> body) {
        authentication.authenticate(request);
        grants.unregister(text(body, "domainId"), text(body, "id"));
        return Map.of("success", true);
    }

    @PostMapping("/product-governance/grant") public Object grant(@RequestBody Map<String,Object> body){
        if(!(body.get("remove") instanceof Boolean remove))throw new IllegalArgumentException("Expected removal intent");
        grants.grant(text(body,"id"),new ProductGrants.Grant(text(body,"principalKind"),text(body,"principalId"),text(body,"verb")),remove);return Map.of("success",true);
    }
    private static String text(Map<String,Object> body,String key){if(!(body.get(key) instanceof String value)||value.isBlank())throw new IllegalArgumentException("Expected "+key);return value;}
}

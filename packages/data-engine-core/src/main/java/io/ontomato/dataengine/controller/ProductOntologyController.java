package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
public class ProductOntologyController {
    public static final String PATH="/ontology/products/service";
    private final ProductOntologyService ontology;
    private final WorkbenchServiceAuthentication authentication;
    public ProductOntologyController(ProductOntologyService ontology,WorkbenchServiceAuthentication authentication){this.ontology=ontology;this.authentication=authentication;}
    public record Registration(String domainId,List<ProductOntologyService.Registration> nodes) {}
    public record Subject(String domainId,String userId) {}
    public record Removal(String domainId,String id,long revision) {}
    @GetMapping("/ontology/products") public Object currentGraph(){var user=io.ontomato.dataengine.util.SystemUtils.getCurUser();if(user==null)throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED,"Current user required");return ontology.graph(user.getDomainId(),user.getId());}
    @PostMapping(PATH+"/register") public Object register(HttpServletRequest request,@RequestBody Registration body){authentication.authenticate(request);if(body.domainId()==null||body.nodes()==null||body.nodes().size()>1000)throw new IllegalArgumentException("Domain and bounded node batch required");ontology.register(body.domainId(),body.nodes());return Map.of("success",true);}
    @PostMapping(PATH+"/graph") public Object graph(HttpServletRequest request,@RequestBody Subject body){authentication.authenticate(request);return ontology.graph(body.domainId(),body.userId());}
    @PostMapping(PATH+"/remove") public Object remove(HttpServletRequest request,@RequestBody Removal body){authentication.authenticate(request);ontology.remove(body.domainId(),body.id(),body.revision());return Map.of("success",true);}
}

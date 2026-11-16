package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
public class ProductSourceFunctionController {
    public static final String PATH="/ontology/products/service/source-function";
    private final WorkbenchServiceAuthentication authentication;
    private final ProductSourceFunctions functions;
    public ProductSourceFunctionController(WorkbenchServiceAuthentication authentication,ProductSourceFunctions functions){this.authentication=authentication;this.functions=functions;}
    public record Registration(String domainId,ProductSourceFunctions.Artifact artifact) {}
    @PostMapping(PATH) public Object register(HttpServletRequest request,@RequestBody Registration body){authentication.authenticate(request);return Map.of("functionId",functions.register(body.domainId(),body.artifact()),"success",true);}
}

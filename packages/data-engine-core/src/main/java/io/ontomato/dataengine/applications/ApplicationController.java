package io.ontomato.dataengine.applications;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.R;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

@RestController
public class ApplicationController {
    public static final String DECLARATIONS = "/platform/applications/self/declarations";
    private final ApplicationCatalog catalog;
    private final IdentityService identity;
    private final WorkbenchServiceAuthentication authentication;
    public ApplicationController(ApplicationCatalog catalog, IdentityService identity, WorkbenchServiceAuthentication authentication) {
        this.catalog = catalog; this.identity = identity; this.authentication = authentication;
    }
    private User current() {
        var user = identity.getCurrentUser();
        if (user == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        return user;
    }
    public record Batch(List<ApplicationCatalog.Builtin> applications) {}
    public record Publication(ApplicationCatalog.Declaration declaration, String releaseId) {}
    @PostMapping(DECLARATIONS)
    public R<?> declare(HttpServletRequest request, @RequestBody Batch batch) {
        String service = authentication.authenticate(request);
        catalog.builtins(service, batch.applications());
        return R.of(Map.of("serviceId", service, "applicationIds", batch.applications().stream().map(ApplicationCatalog.Builtin::id).toList()));
    }
    @GetMapping("/platform/applications")
    public R<?> list(@RequestParam(defaultValue="navigation") String purpose) {
        var user = current();
        return R.of(purpose.equals("schedules") ? catalog.all().stream().filter(a -> catalog.inDomain(a,user) && a.getString("scheduleAdapter") != null).toList() : catalog.visible(user));
    }
    @GetMapping("/platform/applications/{id}")
    public R<?> get(@PathVariable String id) {
        var user = current();
        var app = catalog.require(id);
        if (!catalog.inDomain(app,user)) throw ApplicationCatalog.denied();
        return R.of(catalog.view(app));
    }
    @PutMapping("/platform/applications/{id}/hosted-publication")
    public R<JSONObject> publish(@PathVariable String id, @RequestBody Publication body) {
        return R.of(catalog.publish(id, body.declaration(), body.releaseId(), current()));
    }
}

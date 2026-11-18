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
    public static final String PANEL_SKILL_SOURCES = "/platform/applications/panel-skill-sources";
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
    public record Connected(String id, ApplicationCatalog.Declaration declaration, String upstream, String upstreamPrefix) {}
    public record PanelEntry(String path, String renderer) {}
    public record PanelRegistration(PanelEntry entry, List<ApplicationPanelUse> panelUses,
                                    ApplicationCatalog.Declaration declaration, List<String> entryAccess) {}
    @GetMapping("/platform/applications/{id}/panel-uses")
    @io.ontomato.dataengine.controller.BuildTestAccess(io.ontomato.dataengine.controller.BuildTestAccess.Access.NO_BUSINESS_DATA)
    public R<JSONObject> panelUses(@PathVariable String id) { return R.of(catalog.panelUses(id, current())); }
    @PutMapping("/platform/applications/{id}/panel-uses")
    public R<JSONObject> putPanelUses(@PathVariable String id, @RequestBody PanelRegistration body) {
        return R.of(catalog.putPanelUses(id, body, current()));
    }
    @GetMapping("/platform/page-skills")
    @io.ontomato.dataengine.controller.BuildTestAccess(io.ontomato.dataengine.controller.BuildTestAccess.Access.NO_BUSINESS_DATA)
    public R<PageSkills.Projection> pageSkills() { return R.of(catalog.pageSkills(current())); }
    @PostMapping("/platform/applications/connected")
    public R<JSONObject> connected(@RequestBody Connected body) {
        return R.of(catalog.connected(body.id(), body.declaration(), body.upstream(), body.upstreamPrefix(), current()));
    }
    @PostMapping(DECLARATIONS)
    public R<?> declare(HttpServletRequest request, @RequestBody Batch batch) {
        String service = authentication.authenticate(request);
        catalog.reconcileBuiltins(service, batch.applications());
        return R.of(Map.of("serviceId", service, "applicationIds", batch.applications().stream().map(ApplicationCatalog.Builtin::id).toList()));
    }
    @GetMapping(PANEL_SKILL_SOURCES)
    public R<List<PanelSkills.Source>> panelSkillSources(HttpServletRequest request, @RequestParam String domainId) {
        authentication.authenticate(request);
        if (domainId.isBlank()) throw ApplicationCatalog.bad("A domain is required");
        return R.of(catalog.panelSkillSources(domainId));
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
        if (!catalog.inDomain(app,user) || (ApplicationCatalog.panelManaged(app) && !catalog.canEnter(app, user)))
            throw ApplicationCatalog.denied();
        return R.of(catalog.view(app, user));
    }
    @GetMapping("/platform/applications/platform-assets-access")
    public R<?> productAssetsAccess(){return R.of(Map.of("allowed",catalog.canReconcileProducts(current())));}
    public record IconUpdate(String icon) {}
    @PutMapping("/platform/applications/{id}/icon") public R<?> updateIcon(@PathVariable String id,@RequestBody IconUpdate body){catalog.updateIcon(id,body.icon(),current());return R.of(Map.of("icon",body.icon()));}
    @PutMapping("/platform/applications/{id}/hosted-publication")
    public R<JSONObject> publish(@PathVariable String id, @RequestBody Publication body) {
        return R.of(catalog.publish(id, body.declaration(), body.releaseId(), current()));
    }
    @PutMapping("/platform/applications/{id}/product-publication")
    public R<JSONObject> publishProduct(@PathVariable String id,@RequestBody Publication body){return R.of(catalog.publishProduct(id,body.declaration(),body.releaseId(),current()));}
}

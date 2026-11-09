package io.ontomato.dataengine.applications;

import io.ontomato.dataengine.core.bean.User;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
public class AppEntryController {
    private final ApplicationCatalog catalog;
    private final ApplicationAccess access;
    public AppEntryController(ApplicationCatalog catalog, ApplicationAccess access) { this.catalog = catalog; this.access = access; }
    @GetMapping("/internal/app-entry")
    public ResponseEntity<Void> entry(@RequestHeader(value="X-App-Credential", required=false) String credential,
            @RequestHeader("X-App-Request-Uri") String uri, @RequestHeader(value="X-Forwarded-Prefix", defaultValue="") String prefix) {
        User user = access.entryUser(credential);
        if (user == null) return ResponseEntity.status(401).build();
        String path = uri.split("\\?",2)[0];
        String query = uri.substring(path.length());
        String start = prefix + "/apps/";
        if (!path.startsWith(start)) return ResponseEntity.status(403).build();
        String[] parts = path.substring(start.length()).split("/",2);
        String id = parts[0];
        if (!id.matches("app-[a-z0-9-]+")) return ResponseEntity.status(403).build();
        String tail = parts.length == 2 ? parts[1] : "";
        String decoded = URLDecoder.decode(tail.replace("+", "%2B"), StandardCharsets.UTF_8);
        if (decoded.contains("\\") || decoded.contains("%") || decoded.indexOf(0) >= 0 ||
            java.util.Arrays.stream(decoded.split("/")).anyMatch(s -> s.equals(".") || s.equals("..")) ||
            decoded.matches("(?i)^/*internal(?:/.*)?$")) return ResponseEntity.status(403).build();
        var app = catalog.all().stream().filter(a -> id.equals(a.getString("id"))).findFirst();
        if (app.isEmpty() || !catalog.inDomain(app.get(),user) || !access.canEnter(app.get(),user)) return ResponseEntity.status(403).build();
        String kind = app.get().getString("kind");
        String target;
        var response = ResponseEntity.noContent().header("X-App-Route-Kind",kind);
        if (kind.equals("hosted")) {
            if (app.get().getString("releaseId") == null) return ResponseEntity.status(403).build();
            target = "/internal/hosted-apps/" + id + "/" + app.get().getString("releaseId") + "/" + tail;
        } else if (kind.equals("connected")) {
            var entry = app.get().getJSONObject("entry");
            response.header("X-App-Upstream", entry.getString("upstream"));
            target = entry.getString("upstreamPrefix") + tail;
        } else return ResponseEntity.status(403).build();
        return response.header("X-App-Proxy-Path",target + query).build();
    }
}

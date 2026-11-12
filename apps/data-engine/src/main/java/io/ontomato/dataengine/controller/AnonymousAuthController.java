package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.core.bean.R;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.IdentityService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AnonymousAuthController {
    private final IdentityService identity;

    public AnonymousAuthController(IdentityService identity) {
        this.identity = identity;
    }

    @BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
    @PostMapping("/sso/verify")
    public R<User> verify() {
        return R.of(identity.getCurrentUser());
    }
}

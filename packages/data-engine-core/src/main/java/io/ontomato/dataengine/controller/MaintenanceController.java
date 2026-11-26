package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.MaintenanceService;
import io.ontomato.dataengine.service.authorization.ManagementOperations;
import io.ontomato.dataengine.service.authorization.ManagementOperations.Operation;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/maintenance")
public class MaintenanceController {

    private static final String READ = "records.monitoring.read";

    @Component
    public static final class Operations implements ManagementOperations.Contributor {
        @Override
        public List<Operation> managementOperations() {
            return List.of(new Operation(READ, "查看服务状态", ManagementOperations.Access.READ));
        }
    }

    @Autowired
    private ManagementRequestAccess management;

    @Autowired
    MaintenanceService maintenanceService;

    @GetMapping("/getserviceinfo")
    @ResponseBody
    @Owned
    public JSONObject geServiceInfo() {
        management.requireSystemOrDomain(READ);
        return maintenanceService.getServicesInfo();
    }
}

package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.AuditLog;
import io.ontomato.dataengine.core.bean.Page;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.AuditLogService;
import io.ontomato.dataengine.service.authorization.ManagementOperations;
import io.ontomato.dataengine.service.authorization.ManagementOperations.Operation;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AuditLogController {

    private static final String READ = "records.audit.read";

    @Component
    public static final class Operations implements ManagementOperations.Contributor {
        @Override
        public List<Operation> managementOperations() {
            return List.of(new Operation(READ, "查看审计日志", ManagementOperations.Access.READ));
        }
    }

    @Autowired
    private ManagementRequestAccess management;

	@Autowired
	private AuditLogService auditLogService;
	
    @PostMapping("/auditLog/queryById")
    @Owned
    public ResponseEntity<AuditLog> queryById(@RequestBody Map<String, Object> body) {
        User user = management.require(READ);
        if (!(body.get("id") instanceof String id) || id.isBlank() || id.length() > 64) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.ofNullable(auditLogService.queryById(id, user.getDomainId()));
    }

	@PostMapping("/auditLog/queryPage")
    @ResponseBody
    @Owned
    public Page<AuditLog> queryPage(@RequestBody JSONObject param) {
        User user = management.require(READ);
    	int pageNum = param.getInteger("pageNum");
    	int pageSize = param.getInteger("pageSize");
    	String bussiness = param.getString("bussiness");
    	String operation = param.getString("operation");

        return auditLogService.queryPage(pageNum, pageSize, bussiness, operation, user.getDomainId());
    }
	
}

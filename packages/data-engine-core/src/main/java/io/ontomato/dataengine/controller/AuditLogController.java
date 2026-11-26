package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.AuditLog;
import io.ontomato.dataengine.core.bean.Page;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.panelreads.WorkbenchPanelRead;
import io.ontomato.dataengine.service.AuditLogService;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.authorization.ManagementOperations;
import io.ontomato.dataengine.service.authorization.ManagementOperations.Operation;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class AuditLogController {

    private static final String READ = "records.audit.read";
    private static final Set<String> BUSINESSES = Set.of(AuditLog.BUSSINESS_BKNOWLEDGE, "BTERM",
            AuditLog.BUSSINESS_BEXAMPLE, AuditLog.BUSSINESS_SCHEMA, AuditLog.BUSSINESS_ANALYSIS);
    private static final Set<String> OPERATIONS = Set.of(AuditLog.OPERATION_ADD, AuditLog.OPERATION_UPD, AuditLog.OPERATION_DEL);
    private static final Set<String> QUERY_PARAMETERS = Set.of("page", "business", "operation");

    @Component
    public static final class Operations implements ManagementOperations.Contributor {
        @Override
        public List<Operation> managementOperations() {
            return List.of(new Operation(READ, "Read audit logs", ManagementOperations.Access.READ));
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
        String id = auditId(body.get("id"));
        if (id == null) {
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

    @Bean
    WorkbenchPanelRead auditLogPanelQuery() {
        return new WorkbenchPanelRead("platform:AuditLog", "query", (subject, parameters) -> {
            management.require(subject, READ);
            return panelPage(parameters, subject.identity().domainId());
        });
    }

    @Bean
    WorkbenchPanelRead auditLogPanelRecord() {
        return new WorkbenchPanelRead("platform:AuditLog", "record", (subject, parameters) -> {
            management.require(subject, READ);
            String id = auditId(parameters.get("primaryKey"));
            if (id == null) throw invalidRequest("Invalid audit log ID");
            AuditLog entry = auditLogService.queryById(id, subject.identity().domainId());
            if (entry == null) throw new OwnerRefusal("NOT_FOUND", "Audit log not found");
            return entry;
        });
    }

    private Page<AuditLog> panelPage(Map<String, Object> parameters, String domainId) {
        if (!QUERY_PARAMETERS.containsAll(parameters.keySet())) throw invalidRequest("Unknown audit log query parameter");
        String business = filter(parameters, "business", BUSINESSES);
        String operation = filter(parameters, "operation", OPERATIONS);
        int pageNum = 1;
        int pageSize = 20;
        if (parameters.containsKey("page")) {
            if (!(parameters.get("page") instanceof Map<?, ?> page) || page.size() != 2
                    || !(page.get("number") instanceof Integer number) || number < 1
                    || !(page.get("size") instanceof Integer size) || size < 1 || size > 100)
                throw invalidRequest("Invalid audit log page number or size");
            pageNum = number;
            pageSize = size;
        }

        var result = auditLogService.queryPage(pageNum, pageSize, business, operation, domainId);
        long lastPage = Math.max(1, result.getTotalPages());
        return pageNum > lastPage
                ? auditLogService.queryPage((int) lastPage, pageSize, business, operation, domainId)
                : result;
    }

    private static String filter(Map<String, Object> parameters, String name, Set<String> options) {
        if (!parameters.containsKey(name)) return null;
        if (!(parameters.get(name) instanceof String value) || !options.contains(value))
            throw invalidRequest("Invalid audit log " + name + " filter");
        return value;
    }

    private static String auditId(Object value) {
        return value instanceof String id && !id.isBlank() && id.length() <= 64 ? id : null;
    }

    private static ResponseStatusException invalidRequest(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }
}

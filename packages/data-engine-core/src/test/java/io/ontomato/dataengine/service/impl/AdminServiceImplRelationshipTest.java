package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.AuditLogDao;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;

class AdminServiceImplRelationshipTest {
    private final AdminServiceImpl service = new AdminServiceImpl();
    private final User user = mock(User.class);
    private final AtomicReference<String> stored = new AtomicReference<>("""
        {"classDef":[],"relationship_rule":{"owns":{
          "fromclass":"position","toclass":"person","desc":"owns",
          "fromdesc":"held by","todesc":"holds"
        }}}
        """);

    @BeforeEach
    void wire() {
        JSONRuleDao dao = mock(JSONRuleDao.class);
        when(dao.query("d1")).thenAnswer(call -> JSON.parseObject(stored.get()));
        doAnswer(call -> {
            stored.set(JSON.toJSONString(call.getArgument(0)));
            return null;
        }).when(dao).save(any(), eq("d1"));
        when(user.getDomainId()).thenReturn("d1");
        BusinessConfigService config = mock(BusinessConfigService.class);
        when(config.get("d1")).thenReturn(new BusinessConfig());
        ReflectionTestUtils.setField(service, "dataRagConfig", new DataRagConfig());
        ReflectionTestUtils.setField(service, "jsonRuleDao", dao);
        ReflectionTestUtils.setField(service, "businessConfigService", config);
        ReflectionTestUtils.setField(service, "langService", mock(LangService.class));
        ReflectionTestUtils.setField(service, "auditLogDao", mock(AuditLogDao.class));
    }

    @Test
    void missingJoinFieldsCanBeSavedAndReadWithoutReplacingTheRelation() {
        service.editRelationship("owns", "owns", "employee_no", "id", user);

        JSONObject relation = reload();
        assertEquals("employee_no", relation.getString("fromField"));
        assertEquals("id", relation.getString("toField"));
        assertEquals("position", relation.getString("fromclass"));
        assertEquals("person", relation.getString("toclass"));
        assertEquals("held by", relation.getString("fromdesc"));
        assertEquals("holds", relation.getString("todesc"));
    }

    @Test
    void descriptionOnlyClientsPreserveJoinFieldsAndExplicitEmptyValuesClearThem() {
        service.editRelationship("owns", "owns", "employee_no", "id", user);
        service.editRelationship("owns", "renamed description", null, null, user);
        assertEquals("employee_no", reload().getString("fromField"));
        assertEquals("id", reload().getString("toField"));
        assertEquals("renamed description", reload().getString("desc"));

        service.editRelationship("owns", "renamed description", "", "", user);
        assertEquals("", reload().getString("fromField"));
        assertEquals("", reload().getString("toField"));
    }

    private JSONObject reload() {
        return JSON.parseObject(JSON.toJSONString(service.getJSONRule("d1")))
                .getJSONObject("relationship_rule").getJSONObject("owns");
    }
}

package io.ontomato.dataengine.service.impl;

import java.io.File;
import java.io.FileOutputStream;
import java.util.List;
import java.util.Set;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessDashboard;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessDashboardParameter;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.PythonExecuteService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class ABCProgramServiceImpl implements ABCProgramService {
	
	@Autowired
	private PythonExecuteService pythonExecuteService;
	
	

    @Override
    public Object[] execute(String sessionId, ABCHarnessProgram program, String userId, UserDataPermission permission, String lang, int timeout, String domainId) throws Exception {
        PythonExecuteResult result=pythonExecuteService.execute(sessionId,program.getCode(),timeout,lang,
            io.ontomato.dataengine.service.PythonAuthority.read(userId,domainId),new JSONObject(),java.util.Map.of());
        return new Object[]{authorized(result,program.getSourceAnalysis(),program.getOutKeyRefs(),permission),result};
    }
    @Override
    public Object[] execute(String sessionId, ABCHarnessDashboard dashboard, String userId, UserDataPermission permission, String lang, int timeout, String domainId) throws Exception {
        JSONObject parameters=new JSONObject();
        if(dashboard.getParameters()!=null)for(var parameter:dashboard.getParameters())parameters.put(parameter.getKey(),parameter.getValue());
        PythonExecuteResult result=pythonExecuteService.execute(sessionId,dashboard.getCode(),timeout,lang,
            io.ontomato.dataengine.service.PythonAuthority.read(userId,domainId),parameters,java.util.Map.of());
        return new Object[]{authorized(result,dashboard.getSourceAnalysis(),dashboard.getOutKeyRefs(),permission),result};
    }
    @Override
    public Object[] execute(String sessionId, Function function, String userId, UserDataPermission permission, String sandboxId, String lang, int timeout, String domainId) throws Exception {
        if (!domainId.equals(function.getDomainId())) throw new IllegalArgumentException("Function is outside the current domain");
        JSONObject parameters=new JSONObject();
        if(function.getParameters()!=null)for(var parameter:function.getParameters())parameters.put(parameter.getName(),parameter.getValue());
        boolean read=Function.OPERATION_READ.equals(function.getOperation());
        PythonExecuteResult result=pythonExecuteService.execute(sessionId,function.getCode(),timeout,lang,
            read?io.ontomato.dataengine.service.PythonAuthority.read(userId,domainId):io.ontomato.dataengine.service.PythonAuthority.write(userId,domainId,sandboxId).withClasses(function.getReturnDef() == null ? null : function.getReturnDef().getClassNames()),parameters,java.util.Map.of());
        return new Object[]{read?authorized(result,function.getReturnDef().getSourceAnalysis(),function.getReturnDef().getOutKeyRefs(),permission):null,result};
    }

    private JSONArray authorized(PythonExecuteResult result, JSONObject graph, List<ABCHarnessProgramOutKeyRef> legacy, UserDataPermission permission) throws Exception {
        if (graph == null) graph = io.ontomato.dataengine.service.QuerySourceAnalysis.fromStoredSources(legacy);
        return io.ontomato.dataengine.service.QueryPermissions.mask(parsePythonReturn(result.getResult(), result.getError()), graph, permission);
    }

    @Override
    public JSONArray parsePythonReturn(String pythonOutput, String errorMessage) throws Exception {
        if (errorMessage != null && !errorMessage.isBlank()) throw new Exception("Python execution failed; no data was delivered");
        try {
            JSONObject value = JSON.parseObject(pythonOutput.replaceAll(":\\s*NaN", ": null"));
            if (!value.keySet().equals(Set.of("answer")) || value.getJSONArray("answer") == null)
                throw new IllegalArgumentException();
            return value.getJSONArray("answer");
        } catch (Exception invalid) {
            throw new Exception("Python must print one JSON object containing an answer array");
        }
    }

    @Override
    public JSONArray dealPythonReturn(String pythonOutput, String errorMessage, List<ABCHarnessProgramOutKeyRef> refs, UserDataPermission permission) throws Exception {
        return io.ontomato.dataengine.service.QueryPermissions.mask(parsePythonReturn(pythonOutput, errorMessage),
            io.ontomato.dataengine.service.QuerySourceAnalysis.fromStoredSources(refs), permission);
    }


}

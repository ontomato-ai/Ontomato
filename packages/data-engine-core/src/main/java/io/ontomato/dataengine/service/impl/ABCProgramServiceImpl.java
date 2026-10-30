package io.ontomato.dataengine.service.impl;

import java.io.File;
import java.io.FileOutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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
import io.ontomato.dataengine.service.sys.bean.permission.FieldPermission;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class ABCProgramServiceImpl implements ABCProgramService {
	
	@Autowired
	private PythonExecuteService pythonExecuteService;
	
	private Pattern ANSWER_JSON_PATTERN = Pattern.compile("(\\{[\\s\\S]+\\})" );
	

    @Override
    public Object[] execute(String sessionId, ABCHarnessProgram program, String userId, UserDataPermission permission, String lang, int timeout, String domainId) throws Exception {
        PythonExecuteResult result=pythonExecuteService.execute(sessionId,program.getCode(),timeout,lang,
            io.ontomato.dataengine.service.PythonAuthority.read(userId,domainId),new JSONObject(),java.util.Map.of());
        return new Object[]{dealPythonReturn(result.getResult(),result.getError(),program.getOutKeyRefs(),permission),result};
    }
    @Override
    public Object[] execute(String sessionId, ABCHarnessDashboard dashboard, String userId, UserDataPermission permission, String lang, int timeout, String domainId) throws Exception {
        JSONObject parameters=new JSONObject();
        if(dashboard.getParameters()!=null)for(var parameter:dashboard.getParameters())parameters.put(parameter.getKey(),parameter.getValue());
        PythonExecuteResult result=pythonExecuteService.execute(sessionId,dashboard.getCode(),timeout,lang,
            io.ontomato.dataengine.service.PythonAuthority.read(userId,domainId),parameters,java.util.Map.of());
        return new Object[]{dealPythonReturn(result.getResult(),result.getError(),dashboard.getOutKeyRefs(),permission),result};
    }
    @Override
    public Object[] execute(String sessionId, Function function, String userId, UserDataPermission permission, String sandboxId, String lang, int timeout, String domainId) throws Exception {
        JSONObject parameters=new JSONObject();
        if(function.getParameters()!=null)for(var parameter:function.getParameters())parameters.put(parameter.getName(),parameter.getValue());
        boolean read=Function.OPERATION_READ.equals(function.getOperation());
        PythonExecuteResult result=pythonExecuteService.execute(sessionId,function.getCode(),timeout,lang,
            read?io.ontomato.dataengine.service.PythonAuthority.read(userId,domainId):io.ontomato.dataengine.service.PythonAuthority.write(domainId,sandboxId),parameters,java.util.Map.of());
        return new Object[]{read?dealPythonReturn(result.getResult(),result.getError(),function.getReturnDef().getOutKeyRefs(),permission):null,result};
    }

	@Override
	public JSONArray dealPythonReturn(String pythonOutput, String errorMessage, List<ABCHarnessProgramOutKeyRef> outKeyRefs, UserDataPermission curUserDataPermission) throws Exception {
    	if (errorMessage != null && !"".equals(errorMessage.trim())) {
    		throw new Exception("python error stream: \n```\n" + errorMessage + "\n```\n");
    	}
    	// The returned data must be {"data":[{}, ...]}
        pythonOutput = pythonOutput.replaceAll(":\\s*NaN", ": null");
        JSONArray answer = null;
        try {
        	String answerJSON = this.getAnswerJSON(pythonOutput);
            JSONObject pythonOutputJsonMap = JSON.parseObject(answerJSON);
            answer = pythonOutputJsonMap.getJSONArray("answer");
        } catch (Exception e) {
        	log.error(e.getMessage(), e);
        	String errorPythonOutput = null;
        	if (pythonOutput.length() > 500) {
        		errorPythonOutput = pythonOutput.substring(0, 250) + " ... " + pythonOutput.substring(pythonOutput.length() - 250) + "\n";
        		errorPythonOutput += "The program printed too much output, so only the first and last 250 characters are shown here.";
        	} else {
        		errorPythonOutput = pythonOutput;
        	}
        	String jsonErrorMessage = "The program print result is:\n```\n" + errorPythonOutput + "\n```\n";
        	jsonErrorMessage += "does not conform to the program print format `{\"answer\":[{...}, ...]}`. Check your code again to see whether there are some irrelevant prints written for debug, and remove these irrelevant prints.";
        	throw new Exception(jsonErrorMessage);
        }
        
        Set<String> allKeys = new HashSet<String>();
        for (ABCHarnessProgramOutKeyRef outKeyRef : outKeyRefs) {
			allKeys.add(outKeyRef.getKey());
		}
        for (int i = 0; i < answer.size(); i++) {
			if (!answer.getJSONObject(i).keySet().equals(allKeys)) {
				throw new Exception("The top-level fields of the program print result are inconsistent with outKeyRefs. Modify the Python program or outKeyRefs.");
			}
		}

        // Apply column permission filtering to the data
        Set<String> noPermissionKeys = new HashSet<String>();
        try {
        	for (ABCHarnessProgramOutKeyRef outKeyRef : outKeyRefs) {
				String key = outKeyRef.getKey();
				String className = outKeyRef.getClassName();
				String attrName = outKeyRef.getAttrName();
				Boolean asGroupBy = outKeyRef.getAsGroupBy();
				Boolean statCal = outKeyRef.getStatCal();
				FieldPermission fieldPermission = curUserDataPermission.getFieldPermissionByClassName(className);
				if (curUserDataPermission.isFullData() || fieldPermission != null && !fieldPermission.isEmpty()) { // permissions exist on the class
					if (!curUserDataPermission.isFullData() && !asGroupBy) { // grouping fields are all output
						Set<String> hasPermissionAttrNames = new HashSet<String>();
						hasPermissionAttrNames.addAll(fieldPermission.getVisibleFields()); // detail fields with permission
						if (statCal) { // statistical fields with permission
							hasPermissionAttrNames.addAll(fieldPermission.getGroupableColumns());
						}
						if (!hasPermissionAttrNames.contains(attrName)) {
							noPermissionKeys.add(key);
						}
					}
				} else { // no permission on the class
					noPermissionKeys.add(key);
				}
			}
        } catch (Exception e) {
        	log.error(e.getMessage(), e);
        	throw new Exception("Output attribute source error");
        }
        for (int i = 0; i < answer.size(); i++) {
			JSONObject row = answer.getJSONObject(i);
			Set<String> keys = row.keySet();
			for (String key : keys) {
				if (!allKeys.contains(key) || noPermissionKeys.contains(key)) {
					row.put(key, "****");
				}
			}
		}
        return answer;
	}
	
	private String getAnswerJSON(String pythonOutput){
        Matcher matcherJSON = ANSWER_JSON_PATTERN.matcher(pythonOutput);
        if(matcherJSON.find()){
            String answerJSON = matcherJSON.group(1);
            return  answerJSON;
        } else {
            return null;
        }
    }
	
}

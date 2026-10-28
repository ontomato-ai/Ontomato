package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import java.util.Map;

public interface PythonExecuteService {
    PythonExecuteResult execute(String sessionId,String code,int timeoutMinutes,String lang,
        PythonAuthority authority,JSONObject parameters,Map<String,String> inputFiles) throws Exception;
}

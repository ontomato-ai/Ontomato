package io.ontomato.dataengine.controller;

import java.util.UUID;
import java.util.concurrent.Executors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessCheck;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramDescription;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.CheckService;
import io.ontomato.dataengine.service.CheckServiceV2;
import io.ontomato.dataengine.util.SseEmitterUtil;

@RestController
public class CheckController {

	@Autowired
	private CheckService checkService;
	
	@Autowired
	private CheckServiceV2 checkServiceV2;
	
	@PostMapping(path = "/check/queryBySessionId", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter queryBySessionId(@RequestBody JSONObject param) {
		String sseId = UUID.randomUUID().toString();
    	SseEmitter sseEmitter = SseEmitterUtil.createSseEmitter(sseId);

        Executors.newSingleThreadExecutor().execute(() -> {
        	checkService.queryBySessionId(param.getString("sessionId"), sseId, null);
            SseEmitterUtil.closeSseEmitter(sseId);
        });
        return sseEmitter;
	}
	
}

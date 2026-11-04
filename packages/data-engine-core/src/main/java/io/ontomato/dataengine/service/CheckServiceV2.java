package io.ontomato.dataengine.service;

import java.util.List;

import com.alibaba.fastjson2.JSONArray;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessCheck;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;

public interface CheckServiceV2 {

	public void saveCheckTask(ABCHarnessCheck check);
	
	public void check(ABCHarnessCheck check, List<ABCHarnessProgram> programs, JSONArray recipes, List<String> classNames, String domainId, boolean generateCandidates);
	
	public ABCHarnessCheck queryBySessionId(String sessionId);
	
}

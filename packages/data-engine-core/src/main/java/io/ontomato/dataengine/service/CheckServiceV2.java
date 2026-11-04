package io.ontomato.dataengine.service;

import java.util.List;

import com.alibaba.fastjson2.JSONArray;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessCheck;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;

public interface CheckServiceV2 {

	public void saveCheckTask(ABCHarnessCheck check);

	public void check(ABCHarnessCheck check, List<ABCHarnessProgram> programs, List<String> classNames, String domainId);

	/** Runs inside the candidate job; candidate failures never change the quality conclusion. */
	public void generateCandidates(ABCHarnessCheck check, List<ABCHarnessProgram> programs, JSONArray recipes, String domainId);

	public ABCHarnessCheck queryBySessionId(String sessionId);

}

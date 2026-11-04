package io.ontomato.dataengine.bean.abcHarness;

import java.util.List;

import lombok.Data;

@Data
public class ABCHarnessProgram {

	private String question;
	private String code;
    private com.alibaba.fastjson2.JSONObject queryPackage;
    private com.alibaba.fastjson2.JSONObject parameterValues;
	private List<ABCHarnessProgramOutKeyRef> outKeyRefs;
    private com.alibaba.fastjson2.JSONObject sourceAnalysis;
	
}

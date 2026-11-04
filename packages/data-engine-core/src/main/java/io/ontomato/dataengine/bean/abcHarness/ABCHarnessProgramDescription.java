package io.ontomato.dataengine.bean.abcHarness;

import lombok.Data;

@Data
public class ABCHarnessProgramDescription {

	private String code;
    private com.alibaba.fastjson2.JSONObject queryLogic;
	private String summary;
	private String meaning;
	
}

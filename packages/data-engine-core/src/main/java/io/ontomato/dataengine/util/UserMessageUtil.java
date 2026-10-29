package io.ontomato.dataengine.util;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramDescription;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.dao.*;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;

import lombok.extern.slf4j.Slf4j;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
public class UserMessageUtil {
	
	public static final String LANG = "{{LANG}}";

    public static final String  DATASET_DESC ="{{DATASET_DESC}}";
    public static final String  CLASS_DEF ="{{CLASS_DEF}}";
    public static final String  RELATIONSHIP_DEF ="{{RELATIONSHIP_DEF}}";
    
    public static final String RELATIONSHIP_CHAIN = "{{RELATIONSHIP_CHAIN}}";
    public static final String  BUSSINESS_KNOWLEDGE ="{{BUSSINESS_KNOWLEDGE}}";

	public static final String  USER_CHAT_LOGS = "{{USER_CHAT_LOGS}}";
    public static final String  DSL_RULE = "{{DSL_RULE}}";
    public static final String  USER_QUESTION ="{{USER_QUESTION}}";
    
	public static final String KNOWLEDGE_SUMMARY_PROMPT ="knowledge_summary_prompt.md";

    public static final String JSON_CORRECTOR_PROMPT = "json_corrector.md";
    public static final String JSON_CORRECTOR_WRONG_JSON = "{{WRONG_JSON}}";
    
    public static final String DASHBOARD_RENAMER_PROMPT = "dashboard_renamer.md";
    public static final String DASHBOARD_RENAMER_INPUT = "{{DASHBOARD}}";
    
    public static final String REPORT_CARD_PROGRAMMER_SERVER_PORT = "{{SERVER_PORT}}";

    public static final String ABC_PROGRAM_DESCRIBER_PROMPT = "abc_program_describer.md";
    public static final String PYTHON_CODE = "{{PYTHON_CODE}}";
    
    public static final String QUESTION_CHECKER_V2_PROMPT = "question_checker-v2.md";
    public static final String PROGRAM_DESCRIPTIONS = "{{PROGRAM_DESCRIPTIONS}}";
    
    public static final String ABC_PROGRAM_DASHBOARD_MAKER_PROMPT = "abc_program_dashboard_maker.md";
    
    public static final String READ_FUNCTION_MAKER_PROMPT = "read_function_maker.md";
    
    public static final String STATIC_READ_FUNCTION_NAME_MAKER_PROMPT = "static_read_function_name_maker.md";
    public static final String GENERAL_FUNCTION_NAME = "{{GENERAL_FUNCTION_NAME}}";
    public static final String PARAMETERS = "{{PARAMETERS}}";
    
    public static final String READ_FUNCTION_INSTANCER_PROMPT = "read_function_instancer.md";
    public static final String METRICVIEWS = "{{METRICVIEWS}}";
    
    public static final String METRIC_VIEW_MAKER_PROMPT = "metric_view_maker.md";
    
    public static final String ACTION_MAKER_PROMPT = "action_maker.md";
    
    public static final String ACTION_CODE_EXPLAINER_PROMPT = "action_code_explainer.md";

	public static String getKnowledgeUserMessage(List<Map<String,String>> userChatLogs, List<KnowledgeEntity> listKnowledge, Map<String, Object> jsonRule,
			String lang, LangService langService){
		String knowledgeSummryPrompt = FileUtil.getResourceFileLoadAll(KNOWLEDGE_SUMMARY_PROMPT, "utf-8");
		
		Map<String, String> mapDBSchema =DBSchemaUtil.getDBSchema(jsonRule, null, false);
		//dataset description
		String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
		knowledgeSummryPrompt = knowledgeSummryPrompt.replace(DATASET_DESC, datasetDesc);

		//class definition description
		String classDef = mapDBSchema.get(DBSchemaUtil.KEY_CLASS_DEF);
		knowledgeSummryPrompt = knowledgeSummryPrompt.replace(CLASS_DEF, classDef);

		//relationship definition description
		String relationshipDef = mapDBSchema.get(DBSchemaUtil.KEY_RELATIONSHIP_DEF);
		knowledgeSummryPrompt = knowledgeSummryPrompt.replace(RELATIONSHIP_DEF, relationshipDef);

		//relationship chain definition description
		knowledgeSummryPrompt = knowledgeSummryPrompt.replace(RELATIONSHIP_CHAIN, "");

		//# existing business knowledge
		StringBuffer sbBussinessKnowledge = new StringBuffer("");
		if(listKnowledge != null && listKnowledge.size() >=0){
			for (KnowledgeEntity knowledgeEntity:listKnowledge) {
				sbBussinessKnowledge.append(" - ").append(knowledgeEntity.getKnowledgeText()).append("\n");
			}
		}
		knowledgeSummryPrompt = knowledgeSummryPrompt.replace(BUSSINESS_KNOWLEDGE, sbBussinessKnowledge.toString());

		//# user chat logs
		String jsonStringUserChatLogs = JSONArray.toJSONString(userChatLogs, Feature.PrettyFormat);
		knowledgeSummryPrompt = knowledgeSummryPrompt.replace(USER_CHAT_LOGS, jsonStringUserChatLogs);
		
		//language
        String langValue = langService.get(lang, "lang");
        knowledgeSummryPrompt = knowledgeSummryPrompt.replace(LANG, langValue);

		log.info(">>>\n");
		log.info("sessionid:{}, KnowledgeUserMessage:\n{}","",knowledgeSummryPrompt);
		return knowledgeSummryPrompt;
	}

	public static String getJSONCorrectorUserMessage(String wrongJsonStr) {
		String jsonCorrectorPrompt = FileUtil.getResourceFileLoadAll(JSON_CORRECTOR_PROMPT, "utf-8");
		jsonCorrectorPrompt = jsonCorrectorPrompt.replace(JSON_CORRECTOR_WRONG_JSON, wrongJsonStr);
		log.info(">>>\n");
		log.info("JSONCorrectorUserMessage:\n{}", jsonCorrectorPrompt);
		return jsonCorrectorPrompt;
	}
	
	public static String getABCProgramDescriberUserMessage(ABCHarnessProgram program, String lang, LangService langService, List<String> classNames, Map<String, Object> jsonRule) {
		String prompt = FileUtil.getResourceFileLoadAll(ABC_PROGRAM_DESCRIBER_PROMPT, "utf-8");
		
		Map<String, String> mapDBSchema =DBSchemaUtil.getDBSchema(jsonRule, classNames, false);
        // dataset description
        String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
        prompt = prompt.replace(DATASET_DESC, datasetDesc);

        // class definition description
        String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, classNames);
        prompt = prompt.replace(CLASS_DEF, classDef);
        
        // DSL syntax
        String dslRule = DslRuleUtil.generateWholeDslRule(jsonRule);
        prompt = prompt.replace(DSL_RULE, dslRule);
        
        // Python code
        prompt = prompt.replace(PYTHON_CODE, program.getCode());
        
        // language
        String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);
        
        log.info(">>>\n");
		log.info("ABCProgramDescriberUserMessage:\n{}", prompt);
        return prompt;
	}
	
	public static String getQuestionCheckerV2UserMessage(String sessionId, String question, List<ABCHarnessProgramDescription> programDescriptions, 
			KnowledgeDao knowledgeDao,
			BusinessConfigService businessConfigService, String lang, LangService langService, String domainId) {
		String prompt = FileUtil.getResourceFileLoadAll(QUESTION_CHECKER_V2_PROMPT, "utf-8");

        //overall query logic
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < programDescriptions.size(); i++) {
        	ABCHarnessProgramDescription programDescription = programDescriptions.get(i);
        	sb.append("- Sub-program logic " + (i + 1) + ":\n");
        	sb.append("```\n");
        	sb.append(programDescription.getMeaning() + "\n");
        	sb.append("```\n\n");
        }
        prompt = prompt.replace(PROGRAM_DESCRIPTIONS, sb.toString());
        
        //business knowledge
        String bussinessKnowledge = BussinessKnowledgeUtil.getBussinessKnowledge(knowledgeDao,
				question, businessConfigService.get(domainId).getKnowledgeMaxResult(), domainId);
        prompt = prompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);
        
        //user question
        prompt = prompt.replace(USER_QUESTION, question);
        
        //language
        String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);

        log.info(">>>\n");
		log.info("sessionid:{}, QuestionCheckerV2UserMessage:\n{}",sessionId,prompt);
        return prompt;
	}
	
	public static String getAbcProgramDashboardMakerUserMessage(ABCHarnessProgram program, String lang, LangService langService, Map<String, Object> jsonRule) {
		String prompt = FileUtil.getResourceFileLoadAll(ABC_PROGRAM_DASHBOARD_MAKER_PROMPT, "utf-8");
		
		Map<String, String> mapDBSchema =DBSchemaUtil.getDBSchema(jsonRule, null, false);
        // dataset description
        String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
        prompt = prompt.replace(DATASET_DESC, datasetDesc);

        // class definition description
        String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, null);
        prompt = prompt.replace(CLASS_DEF, classDef);
        
        // DSL syntax
        String dslRule = DslRuleUtil.generateWholeDslRule(jsonRule);
        prompt = prompt.replace(DSL_RULE, dslRule);
        
        // user question corresponding to the hardcoded code
        prompt = prompt.replace(USER_QUESTION, program.getQuestion());
        
        // Python code
        prompt = prompt.replace(PYTHON_CODE, program.getCode());
        
        // language
        String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);
        
        log.info(">>>\n");
		log.info("getAbcProgramDashboardMakerUserMessage:\n{}", prompt);
        return prompt;
	}
	
	public static String getReadFunctionMakerUserMessage(String question, String code, String lang, LangService langService, Map<String, Object> jsonRule) {
		String prompt = FileUtil.getResourceFileLoadAll(READ_FUNCTION_MAKER_PROMPT, "utf-8");
		
		Map<String, String> mapDBSchema =DBSchemaUtil.getDBSchema(jsonRule, null, false);
        // dataset description
        String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
        prompt = prompt.replace(DATASET_DESC, datasetDesc);

        // class definition description
        String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, null);
        prompt = prompt.replace(CLASS_DEF, classDef);
        
        // DSL syntax
        String dslRule = DslRuleUtil.generateWholeDslRule(jsonRule);
        prompt = prompt.replace(DSL_RULE, dslRule);
        
        // user question corresponding to the hardcoded code
        prompt = prompt.replace(USER_QUESTION, question);
        
        // Python code
        prompt = prompt.replace(PYTHON_CODE, code);
        
        // language
        String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);
        
        log.info(">>>\n");
		log.info("getReadFunctionMakerUserMessage:\n{}", prompt);
        return prompt;
	}
	
	public static String getStaticReadFunctionNameMakerUserMessage(Function generalFunction, List<Parameter> parameters, String lang, LangService langService) {
		String prompt = FileUtil.getResourceFileLoadAll(STATIC_READ_FUNCTION_NAME_MAKER_PROMPT, "utf-8");
        
        // general function name
        prompt = prompt.replace(GENERAL_FUNCTION_NAME, generalFunction.getName());
        
        // parameter definition and determined parameter values
        String def = "| Parameter | Description | Type | Determined parameter value |\n| --- | --- | --- | --- |\n";
        for (Parameter parameter : parameters) {
        	def += "| " + parameter.getName() + " | " + parameter.getDescription() + " | " + parameter.getType() + " | " + (parameter.getValue() == null ? "null" : JSON.toJSONString(parameter.getValue(), Feature.WriteMapNullValue)) + " |\n";
        }
        prompt = prompt.replace(PARAMETERS, def);
        
        // language
        String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);
        
        log.info(">>>\n");
		log.info("getStaticReadFunctionNameMakerUserMessage:\n{}", prompt);
        return prompt;
	}
	
	public static String getReadFunctionInstancerUserMessage(String question, List<MetricView> metricViews, 
			KnowledgeDao knowledgeDao, BusinessConfigService businessConfigService,
			String lang, LangService langService, Map<String, Object> jsonRule, String domainId) {
		String prompt = FileUtil.getResourceFileLoadAll(READ_FUNCTION_INSTANCER_PROMPT, "utf-8");
		
		Map<String, String> mapDBSchema =DBSchemaUtil.getDBSchema(jsonRule, null, false);
        // dataset description
        String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
        prompt = prompt.replace(DATASET_DESC, datasetDesc);

        // class definition description
        String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, null);
        prompt = prompt.replace(CLASS_DEF, classDef);
        
        // business knowledge
        String bussinessKnowledge = BussinessKnowledgeUtil.getBussinessKnowledge(knowledgeDao,
				question, businessConfigService.get(domainId).getKnowledgeMaxResult(), domainId);
        prompt = prompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);
        
        // candidate functions
        String functionMd = "";
        for (int i = 0; i < metricViews.size(); i++) {
        	MetricView metricView = metricViews.get(i);
        	functionMd += "## Candidate function " + (i + 1) + "\n";
        	functionMd += "id: " + metricView.getId() + "\n";
        	functionMd += "Parameters:\n";
        	functionMd += "```json\n";
        	JSONArray parameters = new JSONArray();
        	for (Parameter parameter : metricView.getFunction().getParameters()) {
        		JSONObject p = new JSONObject();
        		p.put("name", parameter.getName());
        		p.put("type", parameter.getType());
        		p.put("description", parameter.getDescription());
        		p.put("sample", parameter.getSample());
        		p.put("classNames", parameter.getClassNames());
        		parameters.add(p);
        	}
        	functionMd += JSON.toJSONString(parameters, Feature.WriteMapNullValue, JSONWriter.Feature.PrettyFormat) + "\n";
        	functionMd += "```\n";
        	functionMd += "Business query logic/meaning: " + metricView.getOriginQuestion() + "\n\n";
        }
        prompt = prompt.replace(METRICVIEWS, functionMd);
        
        // user question
        prompt = prompt.replace(USER_QUESTION, question);
        
        // language
        String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);
        
        log.info(">>>\n");
		log.info("getReadFunctionInstancerUserMessage:\n{}", prompt);
        return prompt;
	}
	
	public static String getMetricViewMakerUserMessage(String question, String serverPort, 
			KnowledgeDao knowledgeDao, BusinessConfigService businessConfigService,
			String lang, LangService langService, Map<String, Object> jsonRule, String domainId) {
		String prompt = FileUtil.getResourceFileLoadAll(METRIC_VIEW_MAKER_PROMPT, "utf-8");
		
		Map<String, String> mapDBSchema =DBSchemaUtil.getDBSchema(jsonRule, null, false);
        // dataset description
        String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
        prompt = prompt.replace(DATASET_DESC, datasetDesc);

        // class definition description
        String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, null);
        prompt = prompt.replace(CLASS_DEF, classDef);
        
        // DSL syntax
        String dslRule = DslRuleUtil.generateWholeDslRule(jsonRule);
        prompt = prompt.replace(DSL_RULE, dslRule);
        
        // user requirement
        prompt = prompt.replace(USER_QUESTION, question);
        
        // business knowledge
        String bussinessKnowledge = BussinessKnowledgeUtil.getBussinessKnowledge(knowledgeDao,
				question, businessConfigService.get(domainId).getKnowledgeMaxResult(), domainId);
        prompt = prompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);
        
        // service port
        prompt = prompt.replace(REPORT_CARD_PROGRAMMER_SERVER_PORT, serverPort);
        
        // language
        String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);
        
        log.info(">>>\n");
		log.info("getMetricViewMakerUserMessage:\n{}", prompt);
        return prompt;
	}
	
	public static String getActionMakerUserMessage(String question, String serverPort, 
			KnowledgeDao knowledgeDao, BusinessConfigService businessConfigService,
			String lang, LangService langService, Map<String, Object> jsonRule, String domainId) {
		String prompt = FileUtil.getResourceFileLoadAll(ACTION_MAKER_PROMPT, "utf-8");
		
		Map<String, String> mapDBSchema =DBSchemaUtil.getDBSchema(jsonRule, null, false);
        // dataset description
        String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
        prompt = prompt.replace(DATASET_DESC, datasetDesc);

        // class definition description
        String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, null);
        prompt = prompt.replace(CLASS_DEF, classDef);
        
        // DSL syntax
        String dslRule = DslRuleUtil.generateWholeDslRule(jsonRule);
        prompt = prompt.replace(DSL_RULE, dslRule);
        
        // user requirement
        prompt = prompt.replace(USER_QUESTION, question);
        
        // business knowledge
        String bussinessKnowledge = BussinessKnowledgeUtil.getBussinessKnowledge(knowledgeDao,
				question, businessConfigService.get(domainId).getKnowledgeMaxResult(), domainId);
        prompt = prompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);
        
        // service port
        prompt = prompt.replace(REPORT_CARD_PROGRAMMER_SERVER_PORT, serverPort);
        
        // language
        String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);
        
        log.info(">>>\n");
		log.info("getActionMakerUserMessage:\n{}", prompt);
        return prompt;
	}
	
	public static String getActionCodeExplainerUserMessage(List<Parameter> parameters, Map<String, Object> jsonRule, String lang, LangService langService) {
		String prompt = FileUtil.getResourceFileLoadAll(ACTION_CODE_EXPLAINER_PROMPT, "utf-8");
		
		// dataset description
		Map<String, String> mapDBSchema = DBSchemaUtil.getDBSchema(jsonRule, null, false);
		String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
		prompt = prompt.replace(DATASET_DESC, datasetDesc);
		
		// object class list
		String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, null);
		prompt = prompt.replace(CLASS_DEF, classDef);
		
		// parameter definition
		JSONArray paramsJson = new JSONArray();
		if (parameters != null) {
			for (Parameter parameter : parameters) {
				JSONObject p = new JSONObject();
				p.put("name", parameter.getName());
				p.put("type", parameter.getType());
				p.put("description", parameter.getDescription());
				p.put("sample", parameter.getSample());
				p.put("classNames", parameter.getClassNames());
				paramsJson.add(p);
			}
		}
		prompt = prompt.replace(PARAMETERS, JSON.toJSONString(paramsJson, Feature.WriteMapNullValue, JSONWriter.Feature.PrettyFormat));
		
		// language
		String langValue = langService.get(lang, "lang");
        prompt = prompt.replace(LANG, langValue);
		
		log.info(">>>\n");
		log.info("getActionCodeExplainerUserMessage:\n{}", prompt);
		return prompt;
	}
	
	public static String getOutputKeyDescriptionMDTable(Map<String, String[]> descriptionMap) {
		String markdown = "| Return field | Function | Class description | Field description | Metric description |\n";
		markdown += "| ---- | ---- | ---- | ---- | ---- |\n";
		for (String as : descriptionMap.keySet()) {
			String[] class_attr_indicator_function = descriptionMap.get(as);
			String classDesc = class_attr_indicator_function[0];
			String attrDesc = class_attr_indicator_function[1];
			String indicatorDesc = class_attr_indicator_function[2];
			String function = class_attr_indicator_function[3];
			markdown += "| " + as + " | " + (function == null || "".equals(function.trim()) ? "none" : function) + " | " + classDesc + " | " + attrDesc + " | " + (indicatorDesc == null || "".equals(indicatorDesc.trim()) ? "none" : indicatorDesc) + " |\n";
		}
		return markdown;
	}

}

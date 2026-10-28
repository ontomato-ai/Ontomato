package io.ontomato.dataengine.util;

public class JSONCheckUtil {
    public static String correctJson(String queryJson){
        // Replace the non-JSON characters in the LLM output
//        if (queryJson.startsWith("```json") || queryJson.endsWith("```")) {
//            queryJson = queryJson.replace("```json", "");
//            queryJson = queryJson.replace("```", "");
//        }
//        queryJson = queryJson.replace("<s>", "");
//        queryJson = queryJson.replace("</s>", "");
//        queryJson = queryJson.replace("<final_answer>", "");
//        queryJson = queryJson.replace("</final_answer>", "");
//        queryJson = queryJson.replace("<thinking>", "");
//        queryJson = queryJson.replace("</thinking>", "");
//        queryJson = queryJson.replace("<response>", "").replace("</response>", "");
    	
    	int startJson = queryJson.indexOf("```json");
    	int endJson = queryJson.lastIndexOf("```");
    	if (startJson >= 0 && endJson > startJson) {
    		queryJson = queryJson.substring(startJson + 7, endJson);
    	}
    	
    	queryJson.replace("```json", "");
    	queryJson.replace("```", "");
    	
        return queryJson;
    }
}

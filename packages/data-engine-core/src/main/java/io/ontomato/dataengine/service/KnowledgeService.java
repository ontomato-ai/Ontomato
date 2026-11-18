package io.ontomato.dataengine.service;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.KnowledgeEntity;

import java.util.List;
import java.util.Map;

public interface KnowledgeService {
	
    public String findKnowledge(String question, int pMaxResult, String domainId);

    /** Adds an entry and answers the id it is stored under (one the request named, or the one the store assigned). */
    public String addBussinessKnowledge(String knowledgeID, String knowledgeTitle, String bk,int status,List<String> listknowledgeTags, User user);

    public void editBussinessKnowledge(String knowledgeID, String knowledgeTitle, String bk,int status,List<String> listknowledgeTags, User user);

    public void delBussinessKnowledge(String knowledgeID, User user);

    public Map<String,KnowledgeEntity> getBussinessKnowledge(String domainId);

    public String getBussinessKnowledgeMarkdown(String domainId);

    public List<Map<String,String>> generateBussinessKnowledgeAI(List<Map<String,String>> userTalkJson, Map<String, Object> jsonRule, String lang, String domainId);

}

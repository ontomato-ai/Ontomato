package io.ontomato.dataengine.util;

import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.dao.KnowledgeEntity;

import java.util.List;

public class BussinessKnowledgeUtil {
    public static String getBussinessKnowledge(KnowledgeDao knowledgeDao, String userQuestion,
            int maxKnowledgeResult, String domainId) {
        StringBuilder sb = new StringBuilder();
        List<KnowledgeEntity> knowledge = knowledgeDao.findKnowledge(userQuestion, maxKnowledgeResult, domainId);
        sb.append("## **Business knowledge**\n");
        for (int i = 0; i < knowledge.size(); i++) {
            sb.append(i + 1).append(".  ").append(knowledge.get(i).getKnowledgeText()).append("\n");
        }
        return sb.append("\n").toString();
    }
}

package io.ontomato.dataengine.service.impl;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.AuditLog;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.AuditLogDao;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.dao.KnowledgeEntity;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.KnowledgeService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.UntitledKnowledgeTitlePrefix;
import io.ontomato.dataengine.service.agent.OntologyGenerationPrompts;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
import java.util.*;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class KnowledgeServiceImpl implements KnowledgeService {

  @Autowired private BusinessConfigService businessConfigService;

  @Autowired private LangService langService;

  @Autowired private KnowledgeDao knowledgeDao;

  @Autowired private AuditLogDao auditLogDao;

  @Autowired private OntologyGenerationService generationService;

  private final UntitledKnowledgeTitlePrefix untitledKnowledgeTitlePrefix;

    public KnowledgeServiceImpl(UntitledKnowledgeTitlePrefix untitledKnowledgeTitlePrefix) {
        this.untitledKnowledgeTitlePrefix = untitledKnowledgeTitlePrefix;
    }

  Pattern JSON_PATTERN = Pattern.compile("```json([\\s\\S]+)```");

  @Override
    public String findKnowledge(String question, int pMaxResult, String domainId) {

        int maxResult = businessConfigService.get(domainId).getKnowledgeMaxResult() ;
        if(pMaxResult > 0){
            maxResult = pMaxResult;
        }
        StringBuffer sbKnowledge = new StringBuffer();
        List<KnowledgeEntity> listKnowledgeEntity =  knowledgeDao.findKnowledge(question, maxResult, domainId);
        sbKnowledge.append("### **Business knowledge**\n");
        for (int i = 0; i < listKnowledgeEntity.size(); i++) {
            sbKnowledge.append((i + 1) + ".  " + listKnowledgeEntity.get(i).getKnowledgeText() + "\n");
        }
        sbKnowledge.append("\n");
        return sbKnowledge.toString();
    }

  @Override
    public void addBussinessKnowledge(String knowledgeID, String knowledgeTitle, String bk,int status,List<String> listknowledgeTags, User user) {
        KnowledgeEntity knowledgeEntity = new KnowledgeEntity();
        String knowledgeid = knowledgeID == null || "".equals(knowledgeID.trim()) ? ("knowledge_" + UUID.randomUUID().toString()) : knowledgeID.trim();
        knowledgeEntity.setKnowledgeID(knowledgeid);
        knowledgeEntity.setModifyTime(new Date());
        if(knowledgeTitle == null || knowledgeTitle.isEmpty()){
            knowledgeEntity.setKnowledgeTitle(untitledKnowledgeTitlePrefix.prefix() + knowledgeid);
        } else {
            knowledgeEntity.setKnowledgeTitle(knowledgeTitle);
        }

        knowledgeEntity.setKnowledgeText(bk);
        knowledgeEntity.setStatus(status);
        knowledgeEntity.setKnowledgeTags(listknowledgeTags);

        knowledgeDao.insertKnowledge(knowledgeEntity.getKnowledgeID(),
                user.getDomainId(),
                knowledgeEntity.getKnowledgeTitle(),
                knowledgeEntity.getKnowledgeText(),
                knowledgeEntity.getKnowledgeTags(),
                knowledgeEntity.getCreatorType(),
                knowledgeEntity.getStatus(),
                knowledgeEntity.getModifyTime());
        
        AuditLog auditLog = new AuditLog();
        auditLog.setId(UUID.randomUUID().toString());
        auditLog.setBussiness(AuditLog.BUSSINESS_BKNOWLEDGE);
        auditLog.setByAi(false);
        auditLog.setUserId(user.getId());
        auditLog.setUserName(user.getUserName());
        auditLog.setOperation(AuditLog.OPERATION_ADD);
        BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
		String sysLang = businessConfig.getLang();
        auditLog.setDescription(langService.get(sysLang, "AuditLog.businessKnowledge.add") + ": " + knowledgeEntity.getKnowledgeTitle());
        auditLog.setParamter(JSONObject.toJSONString(knowledgeEntity));
        auditLog.setOperateTime(System.currentTimeMillis());
        auditLogDao.save(auditLog, user.getDomainId());
    }

  @Override
    public void delBussinessKnowledge(String knowledgeID, User user) {
        knowledgeDao.deleteKnowledge(knowledgeID, user.getDomainId());
        
        if (user != null) {
        	AuditLog auditLog = new AuditLog();
            auditLog.setId(UUID.randomUUID().toString());
            auditLog.setBussiness(AuditLog.BUSSINESS_BKNOWLEDGE);
            auditLog.setByAi(false);
            auditLog.setUserId(user.getId());
            auditLog.setUserName(user.getUserName());
            auditLog.setOperation(AuditLog.OPERATION_DEL);
            BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		String sysLang = businessConfig.getLang();
            auditLog.setDescription(langService.get(sysLang, "AuditLog.businessKnowledge.del") + ": " + knowledgeID);
            auditLog.setParamter(knowledgeID);
            auditLog.setOperateTime(System.currentTimeMillis());
            auditLogDao.save(auditLog, user.getDomainId());
        }
    }

  @Override
    public void editBussinessKnowledge(String knowledgeID, String knowledgeTitle, String bk,int status,List<String> listknowledgeTags, User user) {
            knowledgeDao.requireKnowledgeInDomain(knowledgeID, user.getDomainId());
            KnowledgeEntity knowledgeEntity = new KnowledgeEntity();
            knowledgeEntity.setKnowledgeID(knowledgeID);
            knowledgeEntity.setKnowledgeTitle(knowledgeTitle);
            knowledgeEntity.setKnowledgeText(bk);
            knowledgeEntity.setStatus(status);
            knowledgeEntity.setCreatorType(1); //User edit
            knowledgeEntity.setModifyTime(new Date());
            knowledgeEntity.setKnowledgeTags(listknowledgeTags);

            knowledgeDao.insertKnowledge(knowledgeEntity.getKnowledgeID(),
                    user.getDomainId(),
                    knowledgeEntity.getKnowledgeTitle(),
                    knowledgeEntity.getKnowledgeText(),
                    knowledgeEntity.getKnowledgeTags(),
                    knowledgeEntity.getCreatorType(),
                    knowledgeEntity.getStatus(),
                    knowledgeEntity.getModifyTime());
            
            AuditLog auditLog = new AuditLog();
            auditLog.setId(UUID.randomUUID().toString());
            auditLog.setBussiness(AuditLog.BUSSINESS_BKNOWLEDGE);
            auditLog.setByAi(false);
            auditLog.setUserId(user.getId());
            auditLog.setUserName(user.getUserName());
            auditLog.setOperation(AuditLog.OPERATION_UPD);
            BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		String sysLang = businessConfig.getLang();
            auditLog.setDescription(langService.get(sysLang, "AuditLog.businessKnowledge.upd") + ": " + knowledgeEntity.getKnowledgeTitle());
            auditLog.setParamter(JSONObject.toJSONString(knowledgeEntity));
            auditLog.setOperateTime(System.currentTimeMillis());
            auditLogDao.save(auditLog, user.getDomainId());
    }

  @Override
    public Map<String,KnowledgeEntity> getBussinessKnowledge(String domainId) {

        List<KnowledgeEntity> knowledgeEntityList = knowledgeDao.getAllKnowledge(domainId);
        Map<String,KnowledgeEntity> bussinessKnowledges = new HashMap<>();
        for(KnowledgeEntity knowledgeEntity : knowledgeEntityList){
            bussinessKnowledges.put(knowledgeEntity.getKnowledgeID(), knowledgeEntity);
        }

        return bussinessKnowledges;
    }

  @Override
    public String getBussinessKnowledgeMarkdown(String domainId){
        List<KnowledgeEntity> knowledgeEntityList = knowledgeDao.getAllKnowledge(domainId);
        StringBuffer sbBussinessKnowledge = new StringBuffer();

        if(knowledgeEntityList!=null && knowledgeEntityList.size()>0){
            sbBussinessKnowledge.append("## **Business knowledge**\n");
            for (int i=0;i<knowledgeEntityList.size();i++) {
                KnowledgeEntity knowledgeEntity = knowledgeEntityList.get(i);
                sbBussinessKnowledge.append((i + 1) + ".  " + knowledgeEntity.getKnowledgeText() + "\n");
            }
            sbBussinessKnowledge.append("\n");
        }

        return sbBussinessKnowledge.toString();
    }

  @Override
  public List<Map<String, String>> generateBussinessKnowledgeAI(
      List<Map<String, String>> userTalkJson,
      Map<String, Object> jsonRule,
      String lang,
      String domainId) {

    Map<String, KnowledgeEntity> bussinessKnowledges = this.getBussinessKnowledge(domainId);
    Iterator<String> itKeys = bussinessKnowledges.keySet().iterator();
    List<KnowledgeEntity> listSystemKnowledgeToApprove = new ArrayList<>();
    List<String> listSystemToApproveKey = new ArrayList<String>();
    while (itKeys.hasNext()) {
      String key = itKeys.next();
      KnowledgeEntity knowledgeEntity = bussinessKnowledges.get(key);
      if (knowledgeEntity.getStatus() == 0 && knowledgeEntity.getCreatorType() == 0) {
        listSystemToApproveKey.add(key);
        listSystemKnowledgeToApprove.add(knowledgeEntity);
      }
    }
    String userMessage =
        OntologyGenerationPrompts.getKnowledgeUserMessage(
            userTalkJson, listSystemKnowledgeToApprove, jsonRule, lang, langService);
    String kwSessionid = UUID.randomUUID().toString();

    try (var generation =
        generationService.generate("knowledge", kwSessionid, userMessage, lang, domainId)) {
      JSONArray items = generation.result().getJSONArray("knowledge");
      if (items == null) return new ArrayList<>();
      List<Map<String, String>> listNewKnowledge = new ArrayList<>();
      for (Object item : items) {
        JSONObject value = JSONObject.from(item);
        String title = value.getString("title"), knowledge = value.getString("knowledge");
        if (title == null || title.isBlank() || knowledge == null || knowledge.isBlank())
          throw new IllegalArgumentException("Knowledge title and content are required");
        listNewKnowledge.add(Map.of("title", title, "knowledge", knowledge));
      }
      return generation.settle(
          () -> {
            if (!listNewKnowledge.isEmpty())
              createSystemKnowledge(listSystemToApproveKey, listNewKnowledge, domainId);
            return listNewKnowledge;
          });
    }
  }

    private void createSystemKnowledge(List<String> listSystemToApproveKey, List<Map<String,String>> listNewKnowledge, String domainId) {
        // Delete the old knowledge pending approval
        for(int i=0;i<listSystemToApproveKey.size();i++){
            String key = listSystemToApproveKey.get(i);
            this.delBussinessKnowledge(key, null);
        }
        // Add the new knowledge
        for(int j=0;j<listNewKnowledge.size();j++){
            Map<String,String> mapKnowledge = listNewKnowledge.get(j);

            KnowledgeEntity knowledgeEntity = new KnowledgeEntity();
            knowledgeEntity.setCreatorType(0); //Created by the system
            knowledgeEntity.setStatus(0); //Pending approval
            String knowledgeID = "knowledge_" + UUID.randomUUID().toString();
            knowledgeEntity.setKnowledgeID(knowledgeID);
            knowledgeEntity.setModifyTime(new Date());
            if(mapKnowledge.containsKey("title")){
                String title = mapKnowledge.get("title");
                knowledgeEntity.setKnowledgeTitle(title);
            }
            if(mapKnowledge.containsKey("knowledge")){
                String knowledge = mapKnowledge.get("knowledge");
                knowledgeEntity.setKnowledgeText(knowledge);
            }

            knowledgeDao.insertKnowledge(knowledgeEntity.getKnowledgeID(),
                    domainId,
                    knowledgeEntity.getKnowledgeTitle(),
                    knowledgeEntity.getKnowledgeText(),
                    knowledgeEntity.getKnowledgeTags(),
                    knowledgeEntity.getCreatorType(),
                    knowledgeEntity.getStatus(),
                    knowledgeEntity.getModifyTime());
            
            AuditLog auditLog = new AuditLog();
            auditLog.setId(UUID.randomUUID().toString());
            auditLog.setBussiness(AuditLog.BUSSINESS_BKNOWLEDGE);
            auditLog.setByAi(true);
            auditLog.setUserId("AI");
            auditLog.setUserName("AI");
            auditLog.setOperation(AuditLog.OPERATION_ADD);
            BusinessConfig businessConfig = businessConfigService.get(domainId);
    		String sysLang = businessConfig.getLang();
            auditLog.setDescription(langService.get(sysLang, "AuditLog.businessKnowledge.add") + ": " + knowledgeEntity.getKnowledgeTitle());
            auditLog.setParamter(JSONObject.toJSONString(knowledgeEntity));
            auditLog.setOperateTime(System.currentTimeMillis());
            auditLogDao.save(auditLog, domainId);
        }
    }
}

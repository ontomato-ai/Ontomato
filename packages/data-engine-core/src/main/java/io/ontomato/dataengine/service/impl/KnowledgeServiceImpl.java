package io.ontomato.dataengine.service.impl;

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
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class KnowledgeServiceImpl implements KnowledgeService {

  @Autowired private BusinessConfigService businessConfigService;

  @Autowired private LangService langService;

  @Autowired private KnowledgeDao knowledgeDao;

  @Autowired private AuditLogDao auditLogDao;

  private final UntitledKnowledgeTitlePrefix untitledKnowledgeTitlePrefix;

    public KnowledgeServiceImpl(UntitledKnowledgeTitlePrefix untitledKnowledgeTitlePrefix) {
        this.untitledKnowledgeTitlePrefix = untitledKnowledgeTitlePrefix;
    }


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
    public String addBussinessKnowledge(String knowledgeID, String knowledgeTitle, String bk,int status,List<String> listknowledgeTags, User user) {
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
        return knowledgeEntity.getKnowledgeID();
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
    public int countBusinessKnowledge(String domainId) {
        return knowledgeDao.countDomainRows(domainId);
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
}

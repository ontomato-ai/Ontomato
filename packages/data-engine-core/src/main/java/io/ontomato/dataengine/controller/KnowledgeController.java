package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.KnowledgeService;
import io.ontomato.dataengine.util.SystemUtils;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/knowledge")
public class KnowledgeController {

    @Autowired
    private KnowledgeService knowledgeService;
    
    @PostMapping("/findknowledge")
    @ResponseBody
    public String findKnowledge(@RequestBody String findJson)
    {
    	User user = SystemUtils.getCurUser();
        JSONObject jsonObject = JSONObject.parseObject(findJson);
        String question = jsonObject.getString("question");
        int pMaxResult = 0;
        if(jsonObject.containsKey("max_result")){
            pMaxResult = jsonObject.getInteger("max_result");
        }

        String knowledgeMarkdown =knowledgeService.findKnowledge(question, pMaxResult, user.getDomainId());
    	return knowledgeMarkdown;
    }
}

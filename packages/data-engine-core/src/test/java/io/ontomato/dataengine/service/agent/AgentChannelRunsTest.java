package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.alibaba.fastjson2.JSONObject;
import org.junit.jupiter.api.Test;

class AgentChannelRunsTest {
  private static final String ID="11111111-1111-4111-8111-111111111111";
  @Test void onlyTheAuthenticatedHumanEntranceDeclaresAHumanRecipient() throws Exception {
    var callers=mock(AgentCaller.class);var runtime=mock(AgentRuntimeClient.class);
    var actor=JSONObject.of("id",ID,"domainId","d");
    when(callers.open(anyString(),any(OntologyAgentAccess.Context.class))).thenReturn(actor);
    var context=new OntologyAgentAccess.Context(new OntologyAgentStore.Owner("U","d"),null,"human-token",null,"en",System.currentTimeMillis()+60000,null);
    when(runtime.json(anyString(),anyString(),endsWith("/runs"),eq("POST"),any(),any())).thenAnswer(call->call.getArgument(4));
    var host=new AgentChannelRuns(callers,runtime);
    var input=JSONObject.of("role","notification","kind","agent-answer","source",JSONObject.of("kind","user"),"content","Execute","selectedOption",1,"replyTo",ID,"timestamp",1);
    var human=host.send("retriever",ID,ID,input,null,context,true);
    assertEquals(actor,human.getJSONObject("channel").getJSONObject("userRecipient").getJSONObject("actor"));
    assertEquals(actor,human.getJSONObject("input").getJSONObject("respondent"));
    assertEquals(1,human.getJSONObject("input").getIntValue("selectedOption"));
    var background=host.send("retriever",ID,ID,JSONObject.of("role","user","content","Scheduled"),null,context,false);
    assertNull(background.getJSONObject("channel").get("userRecipient"));
  }
}

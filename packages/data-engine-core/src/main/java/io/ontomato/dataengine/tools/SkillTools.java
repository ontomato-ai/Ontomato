package io.ontomato.dataengine.tools;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import com.alibaba.fastjson2.JSON;
import io.ontomato.dataengine.logging.AgentCallContext;
import io.ontomato.dataengine.service.PythonAuthority;
import io.ontomato.dataengine.service.PythonExecuteService;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Remaining Java agents submit packaged Python to the same runtime executor. */
public class SkillTools {
    private final String directory;
    private final PythonExecuteService python;
    public SkillTools(String directory,PythonExecuteService python){this.directory=directory;this.python=python;}
    @Tool("Execute a Python script from the configured skill package in an isolated runtime workspace.")
    public String executePythonFile(@P("Relative script path inside the configured skill package") String pythonfile,
            @P("Script argument, or empty string") String parameter) throws Exception {
        Path root=Path.of(directory).toRealPath(),entry=root.resolve(pythonfile).toRealPath();
        if(!entry.startsWith(root)||!entry.toString().endsWith(".py"))throw new IllegalArgumentException("Script must belong to the configured skill directory");
        Map<String,String> files=new LinkedHashMap<>();
        try(var paths=Files.walk(root)) {
            for(Path file:paths.toList()) {
                if(Files.isSymbolicLink(file))throw new IllegalArgumentException("Skill package symbolic links are not supported");
                if(Files.isRegularFile(file))files.put(root.relativize(file).toString().replace('\\','/'),Base64.getEncoder().encodeToString(Files.readAllBytes(file)));
            }
        }
        String code="import base64, json, pathlib, runpy, sys\nfiles = json.loads("+JSON.toJSONString(JSON.toJSONString(files))+")\n"
            +"for name, value in files.items():\n    target = pathlib.Path('skill') / name\n    target.parent.mkdir(parents=True, exist_ok=True)\n    target.write_bytes(base64.b64decode(value))\n"
            +"sys.path.insert(0, str(pathlib.Path('skill').resolve()))\nsys.argv = "+JSON.toJSONString(List.of("skill/"+root.relativize(entry).toString().replace('\\','/'),parameter==null?"":parameter))+"\nrunpy.run_path(sys.argv[0], run_name='__main__')\n";
        var context=AgentCallContext.current();
        var result=python.execute(context.getSessionId(),code,2,"en",PythonAuthority.calculation(context.getDomainId()),new com.alibaba.fastjson2.JSONObject(),Map.of());
        if(result.getError()!=null&&!result.getError().isBlank())throw new IllegalStateException(result.getError());
        return result.getResult();
    }
}

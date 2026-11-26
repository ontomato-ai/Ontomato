package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.authorization.CapabilityDefinitions.Denied;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = {MetricViewController.class, FunctionController.class})
public class CapabilityDefinitionErrors {
    @ExceptionHandler(Denied.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    public JSONObject denied(Denied error) {
        return JSONObject.of("success", false, "code", error.code(), "message", error.getReason());
    }
}

package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.PreviewExecution;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * The one HTTP answer to a refused preview write, wherever a write entry refuses it. Ordered ahead of
 * {@code BaseControllerAdvice}, whose catch-all would otherwise answer it.
 */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice
public class PreviewExecutionErrors {
  @ExceptionHandler(PreviewExecution.Refused.class)
  @ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
  public JSONObject refused(PreviewExecution.Refused refused) {
    return JSONObject.of("success", false, "code", PreviewExecution.WRITE_CODE, "message", PreviewExecution.WRITE_MESSAGE);
  }
}

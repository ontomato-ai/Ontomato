package io.ontomato.dataengine.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** A build-test admission failure retains its code across query HTTP boundaries. */
public class BuildTestException extends ResponseStatusException {
  private final String code;
  public BuildTestException(HttpStatus status,String reason) {
    super(status,reason);
    code=reason.split(":",2)[0];
  }
  public String getCode() { return code; }
}

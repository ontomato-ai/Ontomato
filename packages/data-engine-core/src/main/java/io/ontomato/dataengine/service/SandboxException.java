package io.ontomato.dataengine.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** A sandbox admission failure retains its code across query HTTP boundaries. */
public class SandboxException extends ResponseStatusException {
  private final String code;
  public SandboxException(HttpStatus status,String reason) {
    super(status,reason);
    code=reason.split(":",2)[0];
  }
  public String getCode() { return code; }
}

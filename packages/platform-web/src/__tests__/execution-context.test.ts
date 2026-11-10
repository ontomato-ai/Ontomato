import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { Router } from "vue-router";
import type { PlatformPreferences } from "@ontomato/platform-admin";
import { APP_HOST_GLOBAL, type AppHost } from "@ontomato/contracts/app-host";
import { buildExecutionContext } from "@ontomato/contracts/build-tests";
import { installAppHost, registerBuildPreview } from "../app-host";

describe("frame execution bindings",()=>{
  it("isolates previews, emits status and requires a new frame for another context",()=>{
    installAppHost({credential:{type:"anonymous"},preferences:{locale:ref("en"),theme:ref("light")} as PlatformPreferences,
      router:{push:vi.fn()} as unknown as Router,onAuthFailure:vi.fn()});
    const host=(window as unknown as Record<string,AppHost>)[APP_HOST_GLOBAL]!;
    const preview={}, published={};const initial=buildExecutionContext("workspace",null);
    const registration=registerBuildPreview(preview,initial);const changed=vi.fn();
    const stop=host.subscribeExecutionContext(preview,changed);
    expect(host.executionContext(preview)).toEqual(initial);
    expect(host.executionContext(published)).toEqual({kind:"live"});
    registration.update({...initial,status:"PREPARING"});expect(changed).toHaveBeenCalledOnce();
    expect(()=>registration.update({...initial,contextId:"new-context"})).toThrow("Reload");
    expect(host.credential()).toEqual({type:"anonymous"});stop();registration.dispose();
    expect(host.executionContext(preview).kind).toBe("build-test");
    expect(()=>registerBuildPreview(preview,{...initial,contextId:"replacement"})).toThrow("Reload");
  });
});

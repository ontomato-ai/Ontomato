import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../../../utils/errors";
import { wrap } from "../agent-host";

/*
 * What the assistant's routes answer when they refuse: the owner's code and message, and the details the refusal carries
 * (a page draft's fields the contract does not accept, 2026-11-22: the page names them in the reader's words, which it
 * cannot do from the message alone).
 */

function response() {
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    headersSent: false,
    status(code: number) { sent.status = code; return this; },
    json(body: unknown) { sent.body = body; return this; },
    end() { return this; },
  } as unknown as Response;
  return { res, sent };
}

describe("an assistant route's refusal", () => {
  it("carries the details its refusal names beside its code and message", async () => {
    const { res, sent } = response();
    const issues = [{ path: ["target", "objectType"], message: "Required" }];
    wrap(async () => { throw new HttpError(400, "Page draft 'x': target.objectType: Required", "INVALID_REQUEST", { path: "x", issues }); })({} as Request, res, (() => {}) as NextFunction);
    await vi.waitFor(() => expect(sent.status).toBe(400));
    expect(sent.body).toMatchObject({
      error: { code: "INVALID_REQUEST", message: "Page draft 'x': target.objectType: Required" },
      details: { path: "x", issues },
    });
  });

  it("adds no details to a refusal that carries none", async () => {
    const { res, sent } = response();
    wrap(async () => { throw new HttpError(404, "Page draft not found"); })({} as Request, res, (() => {}) as NextFunction);
    await vi.waitFor(() => expect(sent.status).toBe(404));
    expect(sent.body).not.toHaveProperty("details");
  });
});

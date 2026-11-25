import type { Application, RequestHandler } from "express";

export function mockApplicationEntry(
  app: Application, path: string, answer: RequestHandler,
) {
  app.get(path + "/resolve-entry", answer);
  app.get(path + "/registered-entry", (req, res, next) => {
    const send = res.json.bind(res);
    res.json = (body) => {
      if (body?.success !== true) return send(body);
      const { applicationId, use, framePanelId } = body.data;
      return send({ success: true, data: { applicationId, use, framePanelId } });
    };
    return answer(req, res, next);
  });
}

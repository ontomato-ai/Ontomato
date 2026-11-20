import {
  PANEL_PERSONAL_STATE_PATH, PANEL_PERSONAL_STATE_READ_PATH, panelPersonalStateReadRequestSchema,
  panelPersonalStateResponseSchema, panelPersonalStateWriteRequestSchema,
} from "@ontomato/contracts/panel-host";
import type { Router } from "express";
import { readPanelPersonalState, writePanelPersonalState } from "../../services/product-panels/personal-state";
import { context, wrap } from "../utils/agent-host";

const collection = "/product-panels";

export function mountPanelPersonalState(router: Router) {
  router.post(PANEL_PERSONAL_STATE_READ_PATH.slice(collection.length), wrap(async (req, res) => {
    const { owner, credentials } = context(req);
    const state = await readPanelPersonalState(owner, credentials, panelPersonalStateReadRequestSchema.parse(req.body));
    res.json(panelPersonalStateResponseSchema.parse(state));
  }));
  router.put(PANEL_PERSONAL_STATE_PATH.slice(collection.length), wrap(async (req, res) => {
    const { owner, credentials } = context(req);
    const state = await writePanelPersonalState(owner, credentials, panelPersonalStateWriteRequestSchema.parse(req.body));
    res.json(panelPersonalStateResponseSchema.parse(state));
  }));
}

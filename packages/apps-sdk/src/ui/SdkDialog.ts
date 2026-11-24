import { ElDialog } from "element-plus/es/components/dialog/index";
import { createSdkOverlay } from "./SdkOverlay";

export const SdkDialog = createSdkOverlay({
  name: "SdkDialog",
  target: ElDialog,
  kind: "dialog",
});

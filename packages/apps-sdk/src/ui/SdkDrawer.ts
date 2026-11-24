import { ElDrawer } from "element-plus/es/components/drawer/index";
import { createSdkOverlay } from "./SdkOverlay";

export const SdkDrawer = createSdkOverlay({
  name: "SdkDrawer",
  target: ElDrawer,
  kind: "drawer",
});

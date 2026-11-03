import { ossProfile } from "./profile";
import { startOssManager } from "./platform";

// Open source has no sign-in: every request is explicitly anonymous.
startOssManager(ossProfile);

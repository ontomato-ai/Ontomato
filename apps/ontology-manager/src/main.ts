import { ossProfile } from "./profile";
import { startManagerShell } from "./shell";

// Open source has no sign-in: every request is explicitly anonymous.
startManagerShell(ossProfile, { credential: { type: "anonymous" } });

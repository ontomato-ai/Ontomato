import type { RequestIdentity } from "./identity";

/*
 * The port the platform shell offers the apps it shows in a same-origin iframe (hosted and connected apps). The shell
 * installs it on its own window before any app frame loads; an app reads it from `window.parent`. Published apps keep
 * the SDK version they were written against, so this is an external contract: a platform upgrade keeps its fields and
 * call semantics.
 */

/** The property of the shell's window that holds the port. */
export const APP_HOST_GLOBAL = "__ONTOMATO_APP_HOST__";

/** What a platform request carries: the signed-in token, an API key, or nothing in the anonymous open-source edition. */
export type AppHostCredential =
  | { type: "token"; token: string }
  | { type: "apiKey"; apiKey: string }
  | { type: "anonymous" };

export type AppHostTheme = "light" | "dark";

/** The platform's language and theme; an app follows them while it is open. */
export interface AppHostPreferences {
  locale: string;
  theme: AppHostTheme;
}

/** The signed-in user, for display only: the server decides every permission. */
export type AppHostUser = Partial<Pick<RequestIdentity, "userId" | "loginCode" | "userName" | "domainId">>;

export interface AppHostSnapshot extends AppHostPreferences {
  /** The platform API root with its deployment prefix and no trailing slash, e.g. `http://host/demo/api`. */
  apiBase: string;
  /** null in the open-source edition, which has no sign-in. */
  user: AppHostUser | null;
}

export interface AppHost {
  snapshot(): AppHostSnapshot;
  /** The credential of the current page load; null when the shell has none, which is not anonymous. */
  credential(): AppHostCredential | null;
  /** Calls the listener on every change of language or theme; the returned function stops it. */
  subscribePreferences(listener: (preferences: AppHostPreferences) => void): () => void;
  /** Opens a platform page in the shell: a route of the shell without the deployment prefix, e.g. `/ontology/objects`. */
  navigate(path: string): void;
  /** A platform request answered 401 (sign-in expired) or 402 (license); the shell decides what follows. */
  onAuthFailure(status: 401 | 402): void;
}

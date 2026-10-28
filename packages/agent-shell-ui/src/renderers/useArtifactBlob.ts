import { onBeforeUnmount, ref, watch } from "vue";
import type { ArtifactRendererProps } from "../types";

/** Reads an artifact once per identity and exposes load state; parse errors are the caller's. */
export function useArtifactText(props: ArtifactRendererProps) {
  const text = ref<string | null>(null);
  const error = ref<string | null>(null);
  let request = 0;
  watch(
    () => props.artifact.id,
    async () => {
      const current = ++request;
      text.value = null;
      error.value = null;
      try {
        const value = await (await props.read()).text();
        if (current === request) text.value = value;
      } catch (cause) {
        if (current === request) error.value = cause instanceof Error ? cause.message : String(cause);
      }
    },
    { immediate: true },
  );
  return { text, error };
}

/** Object URL for binary artifacts, revoked when the artifact changes or the view unmounts. */
export function useArtifactUrl(props: ArtifactRendererProps) {
  const url = ref<string | null>(null);
  const error = ref<string | null>(null);
  let request = 0;
  const revoke = () => {
    if (url.value) URL.revokeObjectURL(url.value);
    url.value = null;
  };
  watch(
    () => props.artifact.id,
    async () => {
      const current = ++request;
      revoke();
      error.value = null;
      try {
        const blob = await props.read();
        if (current === request) url.value = URL.createObjectURL(blob);
      } catch (cause) {
        if (current === request) error.value = cause instanceof Error ? cause.message : String(cause);
      }
    },
    { immediate: true },
  );
  onBeforeUnmount(revoke);
  return { url, error };
}

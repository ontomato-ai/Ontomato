import { ref } from "vue";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { artifactDownloadName, saveBlob } from "./artifacts";

export function useArtifactDownload(read: (artifact: RuntimeArtifact) => Promise<Blob>) {
  const saving = ref(false);
  const failed = ref(false);

  async function download(artifact: RuntimeArtifact) {
    if (saving.value) return;
    saving.value = true;
    failed.value = false;
    try {
      saveBlob(await read(artifact), artifactDownloadName(artifact));
    } catch {
      failed.value = true;
    } finally {
      saving.value = false;
    }
  }

  return { saving, failed, download };
}

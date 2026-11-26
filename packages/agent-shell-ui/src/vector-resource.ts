/** The two opaque path segments written by the data engine in dataset attachment links. */
export interface VectorResourceTarget {
  indexName: string;
  fileName: string;
}

export function vectorResourceTarget(url: string): VectorResourceTarget | undefined {
  const path = url.replace(/^https?:\/\/[^/?#]+/i, "");
  const match = /\/vectorResource\/resource\/([^/?#]+)\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(path);
  if (!match || !match[1] || !match[2] || /[?#]/.test(path)) return;
  try {
    const indexName = decodeURIComponent(match[1]);
    if (/^vector-[^/\\?#%\p{Cc}]+$/u.test(indexName)) return { indexName, fileName: match[2] };
  } catch {
    // A malformed URL is not a vector resource identifier.
  }
}

export type ReadVectorResource = (target: VectorResourceTarget, signal: AbortSignal) => Promise<Blob>;

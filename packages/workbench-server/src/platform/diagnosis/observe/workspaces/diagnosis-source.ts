import type { DiagnosisEvidence, DiagnosisTarget } from "@ontomato/contracts/ops-diagnosis";

/** The caller's own credentials; evidence is read with them and never with a service credential. */
export interface DiagnosisEvidenceCaller {
  domainId: string;
  userId: string;
  token?: string;
  apiKey?: string;
  locale?: string;
}

export interface DiagnosisEvidenceReader {
  resolve(target: DiagnosisTarget, caller: DiagnosisEvidenceCaller): Promise<DiagnosisEvidence>;
}
let installed: DiagnosisEvidenceReader | undefined;
/** The HTTP application supplies the business owner; observe workspaces never import a business store. */
export function installDiagnosisEvidenceReader(reader: DiagnosisEvidenceReader) {
  installed = reader;
}
export function diagnosisEvidenceReader() {
  if (!installed) throw new Error("Diagnosis evidence reader is not installed");
  return installed;
}

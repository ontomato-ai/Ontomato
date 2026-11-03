/**
 * Edition values of the system configuration page: the business defaults, the backend languages this edition's data
 * engine ships and the data adapter card layout. The host passes one of these; defaults, UI language and Node product
 * config are not derived from one another.
 */

/** Original layout of the data adapter card: form label width and a two-column grid for URL and credentials. */
export interface BusinessConfigAdapterDisplay {
  labelWidth: string;
  urlSpan: number;
  credentialSpan: number;
}

/** One backend language option: the stored value and its fixed display label (not derived from the UI locale). */
export interface BusinessConfigLanguageOption {
  value: string;
  label: string;
}

export interface BusinessConfigProps {
  /** Default business config language: shared by the initial value, the load default and the language dropdown placeholder. */
  defaultLanguage: string;
  /** Backend languages this edition's data engine ships resources for, in display order; the only selectable values. */
  languageOptions: readonly BusinessConfigLanguageOption[];
  adapterDisplay: BusinessConfigAdapterDisplay;
}

/**
 * Save/Discard draft state displayed by `<page-header>`: without changes only a disabled Save button renders; with
 * changes the unsaved notice, Discard and Save render together.
 */
export interface PageHeaderDraft {
  /** Whether there are unsaved changes to save or discard. */
  readonly dirty: boolean;
  /** Whether a save operation is currently in flight. */
  readonly saving?: boolean;
  /** Optional explicit save-enabled override; defaults to `dirty && !saving`. */
  readonly canSave?: boolean;
  /** Optional handler invoked when Save is clicked (alternative to listening for `@save`). */
  readonly save?: () => void;
  /** Optional handler invoked when Discard is clicked (alternative to listening for `@discard`). */
  readonly discard?: () => void;
}

/** Localized wording for `<page-header>` draft controls; falls back to platform i18n (`platform.*`). */
export interface PageHeaderLabels {
  readonly save: string;
  readonly discard: string;
  readonly unsavedChanges: string;
}

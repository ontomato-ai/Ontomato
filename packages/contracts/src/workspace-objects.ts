export interface WorkspaceObjectReference {
  className: string;
  primaryKey: string;
  title: string;
}

/** Optional host integration; object views remain usable outside the workbench. */
export interface WorkspaceObjectHost {
  isPinned(reference: WorkspaceObjectReference): Promise<boolean>;
  toggle(reference: WorkspaceObjectReference): Promise<boolean>;
}
export const workspaceObjectHostKey = Symbol.for("ontomato.workspace-object-host");

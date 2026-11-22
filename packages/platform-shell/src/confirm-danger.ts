import { nextTick, type VNode } from "vue";
import { ElMessageBox, type ElMessageBoxOptions } from "element-plus";

const CANCEL_CLASS = "ontomato-danger-confirm-cancel";

/**
 * Prompts the reader to confirm a destructive or lossy action (such as leaving unsaved edits or running an inspected
 * operation): the confirm button uses the danger tone and initial keyboard focus lands on Cancel so pressing Enter
 * never triggers the destructive action by accident.
 */
export function confirmDanger(
  message: string | VNode,
  title: string,
  options: Omit<ElMessageBoxOptions, "message" | "title"> = {},
): Promise<boolean> {
  let settled = false;
  const confirmButtonClass = ["el-button--danger", options.confirmButtonClass].filter(Boolean).join(" ");
  const cancelButtonClass = [CANCEL_CLASS, options.cancelButtonClass].filter(Boolean).join(" ");
  const result = ElMessageBox.confirm(message, title, {
    type: "warning",
    ...options,
    confirmButtonClass,
    cancelButtonClass,
    autofocus: false,
  }).then(
    () => {
      settled = true;
      return true;
    },
    () => {
      settled = true;
      return false;
    },
  );
  // Element Plus FocusTrap focuses the dialog container in its nextTick after visible becomes true; moving focus to the
  // Cancel button right afterward ensures Enter cancels by default without fighting FocusTrap.
  void nextTick()
    .then(() => nextTick())
    .then(() => {
      if (settled || typeof document === "undefined") return;
      const buttons = document.querySelectorAll<HTMLButtonElement>(`.${CANCEL_CLASS}`);
      const cancel = buttons[buttons.length - 1];
      if (cancel && !cancel.disabled) cancel.focus();
    });
  return result;
}

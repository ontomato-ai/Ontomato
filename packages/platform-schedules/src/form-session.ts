import { ref, shallowRef } from "vue";
import type {
  PlatformScheduleContent,
  PlatformScheduleForm,
  PlatformScheduleFormRequest,
} from "@ontomato/contracts/platform-schedules";
import type { SchedulesApi } from "./api";

/**
 * One application's form while a task is being written: the form the application last answered and the reader's draft
 * of its values.
 *
 * The application owns the form. Each answer is the complete form for the draft that was sent, so it replaces the form
 * and the draft whole: a field a selection removed disappears with its value, and nothing of the previous form is
 * merged back. Requests are numbered and only the newest one's answer is taken, so a slow answer for an application the
 * reader has already left never lands on the next one. While a form is being read, and after a read failed, the draft
 * cannot be submitted: what the reader would submit is not the form of the current selection.
 */
export function useApplicationForm(api: Pick<SchedulesApi, "form">) {
  const form = shallowRef<PlatformScheduleForm | null>(null);
  const values = ref<PlatformScheduleContent>({});
  const state = ref<"idle" | "loading" | "ready" | "error">("idle");
  const failure = shallowRef<unknown>(null);
  /** Keys the reader changed since the application last answered: its errors on them no longer describe them. */
  const edited = ref(new Set<string>());
  let sequence = 0;
  let last: { appId: string; request: PlatformScheduleFormRequest } | null = null;

  function adopt(next: PlatformScheduleForm) {
    sequence += 1;
    form.value = next;
    values.value = { ...next.values };
    edited.value = new Set();
    failure.value = null;
    state.value = "ready";
  }

  async function load(appId: string, request: PlatformScheduleFormRequest): Promise<void> {
    const mine = ++sequence;
    last = { appId, request };
    // Another application's fields would be wrong under this one's heading: they go as soon as the reader switches.
    if (form.value && form.value.appId !== appId) {
      form.value = null;
      values.value = {};
    }
    state.value = "loading";
    failure.value = null;
    try {
      const answer = await api.form(appId, request);
      if (mine !== sequence) return;
      if (answer.appId !== appId) throw new Error(`The form of ${answer.appId} answered for ${appId}`);
      adopt(answer);
    } catch (error) {
      if (mine !== sequence) return;
      // The draft stays as it was, so nothing the reader typed is lost; only a new answer makes it submittable again.
      failure.value = error;
      state.value = "error";
    }
  }

  return {
    form,
    values,
    state,
    failure,
    edited,
    load,
    /** A replacement the service handed over itself (a save refused with FORM_CHANGED). */
    adopt,
    /** Reads the last requested form again, after a failure. */
    retry: () => (last ? load(last.appId, last.request) : Promise.resolve()),
    /** Changes one value of the draft; only the field's own key, never another field's. */
    set(key: string, value: string) {
      values.value = { ...values.value, [key]: value };
      edited.value = new Set(edited.value).add(key);
    },
  };
}

export type ApplicationForm = ReturnType<typeof useApplicationForm>;

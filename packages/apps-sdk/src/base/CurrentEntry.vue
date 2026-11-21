<script setup lang="ts">
import { h, inject } from "vue";
import DirectProjection, { directMountKey } from "../panel/direct-projection";

/**
 * Where an application's frame shows the entry the reader opened: the frame's member whose target is the platform's
 * current entry. What is drawn here is the content the host already admitted and runs, placed here and never started
 * again; the frame chooses where it goes, not which panel or with what inputs. Outside an application's frame the place
 * says it shows nothing here.
 */
const props = defineProps<{
  /** The frame's member whose target is `{fromPlatform: "currentEntry"}`. */
  member: string;
}>();

const mount = inject(directMountKey);
if (!mount) throw new Error("CurrentEntry is drawn in a panel the platform runs, which provides its context");
const declaration = mount.instance.direct.members[props.member];
/** The author's mistake, said where the entry would be: a member that is not the platform's current entry. */
const refusal = !declaration
  ? `The panel declares no member '${props.member}'`
  : "fromPlatform" in declaration.target ? null
    : `Member '${props.member}' is not the platform's current entry: CurrentEntry draws only a member whose target is {fromPlatform: "currentEntry"}`;
// Drawn as the frame's member is, in its place: `slot` is the member's name, which a template cannot bind.
const render = () => (refusal ? h("p", { role: "alert", class: "sdk-current-entry-refused" }, refusal) : h(DirectProjection, { slot: props.member }));
</script>

<template>
  <render></render>
</template>

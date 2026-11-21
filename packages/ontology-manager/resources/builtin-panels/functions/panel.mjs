import { computed, ref, watch } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

/*
 * 函数页：左边选中哪一条、搜什么，都是本面板声明过的状态；这一份代码只管页面自己的事——
 * 「新建函数」清空选中并打开属主的空白表单，选中一条就打开它自己的表单，智能体的草稿到了也打开表单。
 * 读取、保存、删除都由投影背后的属主操作完成，这里不自己请求任何接口。
 */

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const values = instance.state.values;
    const selected = computed(() => values.value.selected ?? null);
    const creating = ref(false);

    // 智能体写来的草稿一到，就打开表单让它落进去；保存或放弃由读者决定。
    watch(instance.draft, (draft) => {
      if (draft) creating.value = true;
    }, { immediate: true });
    // 从列表里选了另一条，就不再是新建。
    watch(selected, (next) => {
      if (next) creating.value = false;
    });

    function newFunction() {
      creating.value = true;
      instance.state.set("selected", null);
    }
    function showFunction() {
      creating.value = false;
    }
    function saved() {
      creating.value = false;
    }
    function discard() {
      creating.value = false;
    }

    return { selected, creating, newFunction, showFunction, saved, discard };
  },
});

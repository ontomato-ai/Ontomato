import { computed, watch } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

/*
 * 函数页：左边选中哪一条、搜什么、是不是在新建，都是本面板声明过的状态；页头的「新建函数」命令清空选中、把
 * creating 设为 true。这一份代码只管页面自己的事——选中一条就打开它自己的表单，智能体的草稿到了也打开表单，
 * 保存或放弃后回到查看。
 * 读取、保存、删除都由投影背后的属主操作完成，这里不自己请求任何接口。
 */

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const values = instance.state.values;
    const selected = computed(() => values.value.selected ?? null);
    const creating = computed(() => values.value.creating === true);
    const setCreating = (value) => instance.state.set("creating", value);

    // 智能体写来的草稿一到，就打开表单让它落进去；保存或放弃由读者决定。
    watch(instance.draft, (draft) => {
      if (draft) setCreating(true);
    }, { immediate: true });
    // 从列表里选了另一条，就不再是新建。
    watch(selected, (next) => {
      if (next) setCreating(false);
    });

    function showFunction() {
      setCreating(false);
    }
    function saved() {
      setCreating(false);
    }
    function discard() {
      setCreating(false);
    }

    return { selected, creating, showFunction, saved, discard };
  },
});

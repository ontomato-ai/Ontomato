# 函数目录面板：这一页上的活怎么干

这一页是本域函数的整宽目录（`/ontology/assets/functions`）：按名称和说明搜索函数、浏览名称/操作类型/说明，点击任意一行进入整宽详情入口（`/ontology/assets/functions/detail?selected=<id>`），或点击页头「新建函数」进入整宽新建态（`/ontology/assets/functions/detail?mode=create`）。

## 这一页有什么

- 整宽表格 `list` 读 `platform:Function` 的 `query`，展示名称、操作类型（读 / 写 / 产品）和说明；搜索框绑定面板状态 `search`（进地址深链），页码由表格内部管理不进地址。
- 不默认选中第一条；点行通过 `@choose` 跳转到详情入口。
- 页头右侧提供刷新与主按钮「新建函数」，点「新建函数」直接打开详情入口的新建态。

## 读取与导航

- 搜索函数：用 `present` 打开 `/ontology/assets/functions` 并设置 `search`（按名称和说明匹配，不区分大小写）。
- 想按操作类型或类名筛选函数，用平台的 `function list` 过滤，不要自己遍历全部再筛。
- 查看、修改、新建或删除某条函数：直接用 `present` 打开详情入口 `/ontology/assets/functions/detail`，传入 `{ selected: { className: "platform:Function", primaryKey: "<id>" } }`（查看/编辑）或 `{ mode: "create" }`（新建），具体表单填写与保存见函数详情面板的 `recipes.md`。

函数目录页本身不执行写入，也不提供测试或执行。

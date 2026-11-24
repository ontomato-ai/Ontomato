# 对象详情页

这一页挂在对象浏览器应用的 `/browser/views`（无侧栏菜单名），用于整页查看单个业务对象：

- 公开深链状态：
  - `selected`：任意对象引用 `{ className, primaryKey }`（URL 编码为 `?selected=<className>~<primaryKey>`）。
  - `returnTo`：可选来源标记（`workspace` 时返回 `/workspace`，否则返回 `/browser/data/<className>`）。
- 页头包含：返回按钮、由 `headerTitle`（`ObjectHeader` 读取 `platform:ObjectType.instanceRecord`）渲染的对象主展示名、收藏星标按钮（通过 `favoriteStatus` 读取 `platform:Favorite.record` 并执行 `favorites.add` / `favorites.remove`）、刷新按钮，以及当 `canConfigure` 为真时可见的「配置呈现」按钮。
- 「配置呈现」打开页内弹窗（本地状态，不写地址），使用 `detailPanelForm`（`ObjectForm` + `detailPanelPicker` 绑定 `platform:ObjectType.detailPanelForm` 与 `platform:ObjectType.saveDetailPanel`）、`clearDetailPanel`（`objectTypes.clearDetailPanel` 恢复默认只读详情）以及前往 `/ontology/panels` 新建/管理详情面板的入口。
- 页面主体固定嵌套 `builtin-product-object-detail-body`（成员 `body`），与外层双向同步 `selected`；在主体内点击关联对象会同步更新页头与地址栏。

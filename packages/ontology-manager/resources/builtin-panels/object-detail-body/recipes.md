# 对象详情内容面板

这一张面板不画页头，负责根据外部传入的对象引用 `selected`（`{ className, primaryKey }`）呈现对象详情主体：

- 自动把 `selected.className` 同步给内部 `selectedClass`（`platform:ObjectType`），通过 `detailBinding` 读取 `platform:ObjectType.detailPanel` 的绑定状态（`panelStatus`、`panelId`、`configured`、`canConfigure`）。
- 当 `panelStatus === "configured"`：通过动态嵌套成员 `customDetail`（`{ fromState: "selected", candidates: { rule: "objectDetail" } }`）渲染该对象类型已配置的自定义详情面板，双向同步 `selected`。
- 当 `panelStatus === "unavailable"` 或 `"forbidden"`：在原位通过 `detailBinding` 展示属主返回的不可用/无权提示，不降级到通用属性视图。
- 仅当 `panelStatus === "unconfigured"`：渲染内置只读默认详情，由 `defaultSummary`（`ObjectSummary`，绑定 `platform:ObjectType.instanceRecord`）与 `defaultRelations`（`ObjectRelations`，绑定 `platform:ObjectType.instanceNeighbors`）组成；点击关联对象直接更新 `selected`。

这张面板既被 `builtin-product-object-detail` 整页嵌套复用，也被个人工作台抽屉直接挂载（按 `/home` 入口准入）。

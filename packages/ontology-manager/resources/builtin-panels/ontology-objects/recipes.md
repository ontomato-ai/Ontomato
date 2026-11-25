# 对象类型页

这一页是本体里对象类型的目录和类详情，同一张面板：

- 面板状态 `selected` 为空时是**目录**：通过 `catalog`（`ObjectList`）列出全部对象类型（`platform:ObjectType.list`），可按 `search` 里的关键词在显示名、API 名与业务说明里筛选。
- `selected` 指向一个 `platform:ObjectType`（主键就是类的 API 名）时是这个类的**详情**：页头与摘要由 `detail`（`ObjectHeader`）和 `summary`（`MetricCard`）读取 `platform:ObjectType.record`（属性数、业务键数、主键数、关系数，主键状态 `primaryKeyStatus`、主键显示名 `primaryKeyShowName`、主键名 `primaryKeyName` 与主键数量 `primaryKeyCount`），右侧展示属性列表 `attributes`（`ObjectList`，读取 `platform:Attribute.list`）与关联关系列表 `relations`（`ObjectList`，读取 `platform:Relationship.list`）。
- 新建对象类型通过页头「新建对象类型」触发，将公开状态 `creating` 置为 `true` 并清空选中以打开 `objectForm` 创建弹窗；填完保存后进入新类的详情。
- 公开状态 `creatingAttribute`（不写地址）为 `true` 时，在当前选中类（`selected`）下打开 `attributeForm` 新建属性弹窗；填完保存后关闭弹窗并刷新属性列表。
- 目录、类详情都在同一张面板；直接打开某个类用本页地址 `<页地址>?selected=<类 API 名>`。
- 展开属性列表 `attributes` 的某一行，会在该行下方通过 `attributeRowForm`（行级 `ObjectForm`）内联编辑属性（显示名、说明、启用、业务键、主键，以及末尾的删除与保存操作）。

回答“这是哪一页、选中了什么”时，先看 `selected`，再用上面的读取取当前字段，不要凭记忆。要让读者看到某个类，给出本页地址并带上 `?selected=<类 API 名>`。

## 填写表单（经确认或读者点击保存后才写入）

填写前先读对应属主的表单（`objectForm` 的 `form`/`createForm`、`attributeForm` 的 `createForm`、`attributeRowForm` 的 `form`），字段路径以属主表单为准。先用 `present` 打开对应视图或弹窗，再用 `fill_form` 直接填入实时表单；需要保存时调用对应表单的 `page_action`（默认在对话中请读者确认后才提交）。

- 新建对象类型：用 `present({ selected: null, creating: true })` 打开 `objectForm` 创建弹窗，再对 `objectForm` 调 `fill_form` 填 API 名、主键名、显示名、业务描述。格式和重名由属主校验，原因显示在字段旁。
- 修改对象类型：用 `present` 选中类（`selected: { className: "platform:ObjectType", primaryKey: "<类 API 名>" }`），对 `objectForm` 调 `fill_form`（只有显示名和业务描述可改，API 名只读）。
- 新建属性：用 `present` 选中所属类（`selected`）并设 `creatingAttribute: true` 打开新建属性弹窗，所属对象类型由页面固定为当前类，读者不能改；再对 `attributeForm` 调 `fill_form`。
- 修改属性：在类详情的 `attributes` 表中展开对应属性行，使用行下内联的 `attributeRowForm` 修改显示名、描述、启用、业务键或将符合条件的 `varchar` 属性设为主键（勾选主键保存时会由属主展示替换影响确认并原子写入）。

## 需要确认才执行的操作

- 删除对象类型 `deleteObject.delete`（目标是 `selected`）：会连同两端涉及这个类的关系一起删除。执行前先读 `relations` 的 `rows`，向读者点名会被一起删掉的关系；经读者确认后执行，完成后页面回到目录。
- 删除属性 `attributes.delete`（行操作，位于行下编辑区末尾）：若当前是主键属性或被某条关系用作关联字段，属主会标记为不可执行或拒绝并给出原因；把属主给的原因原样告诉读者。

写操作都经平台的确认后才执行；读者取消就不执行。执行后用读取核对结果再汇报。

## 跳转

- 配置对象呈现：页头点击「配置呈现」在页内打开配置弹窗（本地状态，不写地址），通过 `detailBinding` 展示当前详情面板绑定状态，通过 `detailPanelForm`（搭配 `detailPanelPicker`）绑定 `platform:ObjectType.detailPanelForm` 与 `platform:ObjectType.saveDetailPanel` 更换或清空自定义详情面板，通过 `clearDetailPanel`（`objectTypes.clearDetailPanel`）一键恢复默认只读详情，并提供前往 `/ontology/panels` 新建或管理详情面板的入口。
- 浏览数据：`/browser/data/<API 名>`
- 某条关系：关系类型详情页 `/ontology/relations/detail?selected=<关系名>`（点击关系列表中的任意一行即可跳转）

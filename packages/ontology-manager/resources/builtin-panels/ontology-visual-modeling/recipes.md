# 可视化建模页的常见做法

这一页在平台的共用图谱画布上编辑本域的对象类型（点）、关系类型（边）和它们下面的属性：拖动布局、按住 Shift 从一个类拖到另一个类建关系、选中后编辑或删除。

## 看页面上是什么

- 画布上是本域的全部对象类型和关系类型，节点和边都写属主给的名字，不是内码。
- `selectedNode` 是选中的对象类型（主键是类的 API 名），`selectedEdge` 是选中的关系类型（主键是关系名）；两者互斥（后选中的会覆盖清空前一个，改选关系时同时清空 `selectedAttribute`），点画布空白处或按 Esc 清空选中。只有选中节点时才展开右侧检查栏，单击边保持全幅画布并通过画布顶栏的编辑、删除按钮操作。地址里带 `?selectedNode=<类>` 或 `?selectedEdge=<关系名>` 就是直接打开并选中它；由本体图谱跳转进入时附带 `back=playground`，页头显示「返回图谱」按钮。
- 属性列表（`attributes`）直接按当前 `selectedNode` 的主键加载，不另存中转状态；`selectedAttribute` 指向其中一条属性（可写入地址），切换节点或改选关系时自动清空；新建属性通过独立弹窗（`dialog: "attribute"` + `attributeCreate`）完成，固定所属对象类型。
- `dialog` 是页面开着的对话框：`class`（新建对象类型）、`editClass`（编辑对象类型）、`relation`（新建关系类型）、`editRelation`（编辑关系类型）、`attribute`（新建属性），仅公开状态、不写入地址；新建对象类型或关系类型成功后自动选中新建节点或新建边；关闭对话框（设回 `null`）或直接设 `dialog: "relation"`（未同批传入 `connectFrom`/`connectTo`）时会自动清掉残留的连线端点。
- 回答“现在选了什么、在改什么”时，先看这几个状态，再用本页声明的读取（`nodeHeader`、`edgeHeader`、`attributes` 及对应表单）取当前字段，不要凭记忆。

## 填写表单（经保存后才写入）

填表前先读属主表单（类的 `classForm`/`classCreate`、关系的 `relationForm`/`relationCreate`、属性的 `attributeForm`）。先用 `present` 选中目标或打开对应弹窗（如 `selectedNode`、`selectedEdge`、`selectedAttribute`、`dialog: "class"` / `"relation"`），再用 `fill_form` 往当前挂载的表单填入要改的字段（页面标出改动并保持未保存）；需要保存时用 `page_action` 调用对应表单的保存操作（默认在对话中确认，全自动会话直接保存），否则由读者在表单里检查并保存。

- 改类：只有显示名和说明可改，API 名只读。
- 新建类：字段是 API 名、主键名、显示名、业务描述；格式和重名由属主校验，原因显示在字段旁。
- 改关系：两端对象和关系名只读，可改两个关联字段和说明；关联字段从两端对象的属性里选，换了任一端要再问一次表单拿新选项。
- 新建关系：关系名、两端对象、两个关联字段、说明都由属主给；直接打开 `dialog: "relation"` 时两端保持空白可自由选择，按住 Shift 在画布上拖线或同批传入 `connectFrom`/`connectTo` 时会预填进这张表单。
- 改属性：可改显示名、说明、启用、业务键；属性名、数据类型、所属类只读。

## 需要确认才执行的操作

- 删除对象类型 `classDelete`：会连同两端任一是它的关系一起删掉。执行前先读画布上的边，点名会被一起删掉的关系；经读者确认后执行。
- 删除关系类型 `relationDelete`、删除属性 `attributeDelete`：都要读者确认。设主键用 `attributePrimaryKey`；已是主键的属性不要再设。
- 属主拒绝时把它给的原因原样转告读者，不要换别的办法绕过去。

## 跳转

- 本体图谱页 `/ontology/playground` 选中某个类或关系后“去建模”会带着它与 `back=playground` 打开本页（`/ontology/visual-modeling?selectedNode=<类>&back=playground` 或 `/ontology/visual-modeling?selectedEdge=<关系名>&back=playground`），页头此时显示「返回图谱」按钮。

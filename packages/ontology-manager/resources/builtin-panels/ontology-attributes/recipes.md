# 属性页的常见做法

这一页按所属对象类型列出本体属性（`platform:Attribute`），人可以筛选、搜索、查看与编辑详情、新建、设主键、删除，并跳转到所属对象类型。属性的主键是
`["<类名>","<属性名>"]` 这样的 JSON 文本，例如 `["org","name"]`。

## 看页面上是什么

- 新建属性是页头的「新建属性」按钮：它打开新建属性弹窗（`creating: true`），并把所属对象类型固定在当前筛选的类（`createIn`，没筛选就不固定）。
- 当前筛选以扁平参数写在页面地址里：`?className=<类名>&search=<搜索词>`（`className` 是所属对象类型筛选，通过工具栏对象类型选择器 `ownerPicker` 切换或清空回全部对象类型；`search` 在显示名、属性名、数据类型、所属类 API 名与显示名、说明里查）。
- 选中的属性是页面状态 `selected`（扁平参数 `?selected=<属性主键>`），选中后进入属性详情编辑视图。要看它的当前字段，读 `detail` 成员的 `record`；要看某一类的全部属性，读 `attributes` 成员的 `rows`，`className` 参数填类名。
- 回答时说清：筛选的是哪个类（或全部）、搜索词、选中的是哪条属性（显示名和 `类名.属性名`），以及它的数据类型、是否启用、是否业务键、是否主键。

## 填写修改

1. 先读选中属性的属主表单：`form` 成员的 `form`。可改的只有显示名 `showName`、说明 `attrDesc`、启用 `enable`、业务键
   `businessKey`；所属对象类型、属性名、数据类型只读，主键不在表单里改。
2. 用 `present` 将页面定位到这条属性（`selected: { className: "platform:Attribute", primaryKey: "<属性主键>" }`、`creating: false`），再用 `fill_form` 直接填入需要修改的字段；需要保存时再调用 `page_action({ operation: "form.save" })`（默认经读者确认后提交）。

## 填写新建

1. 读 `form` 成员的 `createForm`，数据类型的选项以属主表单给的为准。
2. 用 `present({ selected: null, creating: true })` 打开新建弹窗（若当前已按 `className` 筛选，页面会自动固定 `createIn` 为该类；也可显式传入 `createIn: "<类名>"` 固定所属类）。
3. 用 `fill_form` 填写字段时，按所属类是否固定走对应路径：
   - **所属类已固定**（当前已按 `className` 筛选，或已显式设置 `createIn`）：**不要在 `fill_form` 里填 `className`**（该字段已固定为只读，填写会被拒绝），只填 `name`、`type`、`showName`，按需填 `attrDesc`、`enable`、`businessKey`、`primaryKey`。
   - **未固定所属类**（未按类筛选且未设 `createIn`）：在 `fill_form` 里填 `className`、`name`、`type`、`showName`，按需填 `attrDesc`、`enable`、`businessKey`、`primaryKey`。
4. 需要保存时调用 `page_action({ operation: "form.save" })`。属性名格式、重名由属主在保存时判定，原因显示在字段旁；保存后页面选中新属性并打开详情。

## 设主键、删除

- 设主键用 `setPrimaryKey` 成员的操作，删除用 `remove` 成员的操作，目标是那条属性
  （`{"kind":"object","objectType":"platform:Attribute","primaryKey":"<主键>"}`）。这两个都要读者在对话里确认后才执行。
- 已经是主键、已停用或非字符串类型的属性，「设为主键」（`setPrimaryKey`）会由属主标记不可用并给出原因，不要再设主键；对可设为主键的属性设主键后，原来的主键属性不再是主键，确认前告诉读者是哪一条。
- 主键属性、被关系用作关联字段的属性，属主会标记删除不可用或拒绝删除：把属主给的原因原样转告读者，不要换别的办法绕过去。

# 属性页的常见做法

这一页按所属对象类型列出本体属性（`platform:Attribute`），人可以筛选、搜索、在行下展开内联编辑、新建、设主键、删除，并跳转到所属对象类型。属性的主键是
`["<类名>","<属性名>"]` 这样的 JSON 文本，例如 `["org","name"]`。

## 看页面上是什么

- 新建属性是页头的「新建属性」按钮：它打开新建属性弹窗（`creating: true`），所属对象类型可在弹窗内自由选择（不受目录筛选锁定）。
- 当前筛选以扁平参数写在页面地址里：`?className=<类名>&search=<搜索词>`（`className` 是所属对象类型筛选，通过工具栏对象类型选择器 `ownerPicker` 切换或清空回全部对象类型；`search` 在属性显示名、API 名、数据类型与所属类显示名里查）。
- 展开列表 `attributes` 中的任意一行，会在该行下方通过行级 `attributeRowForm`（`ObjectForm`）内联编辑该属性，点击所属类链接可直接跳转到对象类型详情页。

## 填写修改

1. 展开对应属性行后，行下内联表单 `attributeRowForm` 展示显示名 `showName`、说明 `attrDesc` 以及横排的启用 `enable`、业务键 `businessKey`、主键 `primaryKey` 开关。
2. 符合条件的 `varchar` 属性可直接在编辑表单中打开 `primaryKey` 开关并随保存提交（属主自动校验并展示替换原主键的影响确认，原子写入）；当前已是主键或非 `varchar` 类型的属性，`primaryKey` 开关会由属主标记只读并给出原因。
3. 表单未修改时保存按钮禁用，修改后显示未保存提示并可点击放弃或保存。

## 填写新建

1. 读 `form` 成员的 `createForm`，所属对象类型与数据类型的选项以属主表单给的为准。
2. 用 `present({ creating: true })` 打开新建弹窗。
3. 用 `fill_form` 填写 `className`、`name`、`type`、`showName`，按需填 `attrDesc`、`enable`、`businessKey`、`primaryKey`。
4. 需要保存时调用 `page_action({ operation: "form.save" })`。属性名格式、重名与主键替换影响确认由属主处理；保存后关闭弹窗并刷新目录。

## 删除

- 删除操作（`attributes.delete`）作为列表行操作置于行下编辑区末尾，需经读者确认后执行。
- 主键属性、被关系用作关联字段的属性，属主会标记删除不可用并给出原因：把属主给的原因原样转告读者，不要换别的办法绕过去。

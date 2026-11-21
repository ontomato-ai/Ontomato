# 属性页的常见做法

这一页按所属对象类型列出本体属性（`platform:Attribute`），人可以筛选、搜索、新建、修改、设主键和删除。属性的主键是
`["<类名>","<属性名>"]` 这样的 JSON 文本，例如 `["org","name"]`。

## 看页面上是什么

- 新建属性是页头的「新建属性」命令：它把页面切到新建表单，并把所属对象类型固定在当前筛选的类（没筛选就不固定）。

- 当前筛选在页面地址的 `state` 里：`className` 是所属对象类型筛选（类名，没有就是全部对象类型），`search` 是搜索词
  （在显示名、属性名、数据类型、所属类显示名里查）。
- 选中的属性是页面状态 `selected`。要看它的当前字段，读 `detail` 成员的 `record`；要看某一类的全部属性，读
  `attributes` 成员的 `rows`，`className` 参数填类名。
- 回答时说清：筛选的是哪个类（或全部）、搜索词、选中的是哪条属性（显示名和 `类名.属性名`），以及它的数据类型、是否业务键、是否主键。

## 起草修改

1. 先读选中属性的属主表单：`form` 成员的 `form`。可改的只有显示名 `showName`、说明 `attrDesc`、启用 `enable`、业务键
   `businessKey`；所属对象类型、属性名、数据类型只读，主键不在表单里改。
2. 草稿的 `operation` 用表单 `save.draftOperation`（修改是 `attribute.update`），`target.id` 用属性主键，`form` 只放要改的字段，
   `pageKey` 是 `ontology-attributes`。
3. 链接要带上这条属性的选中状态，读者打开时编辑表单才对准它：
   `#/ontology/attributes?state=<{"selected":{"className":"platform:Attribute","primaryKey":"<主键>"}}>&draftSessionId=…&draftRunId=…&draftPath=…`
   （`state` 的 JSON 和三个草稿参数都交给 `URLSearchParams` 编码一次）。`draftPath` 写产物的相对路径，例如
   `outputs/drafts/attr-edit.page-draft.json`，不要写成 `/data/...` 这样的绝对路径，否则页面打不开草稿。
   草稿不写入，读者在页面上保存才写入。

## 起草新建

1. 读 `form` 成员的 `createForm`，数据类型的选项以属主表单给的为准。
2. 草稿 `operation` 是 `attribute.create`，`target` 为空对象，`form` 填 `className`、`name`、`type`、`showName`，按需填
   `attrDesc`、`enable`、`businessKey`、`primaryKey`。
3. 所属对象类型由草稿里的 `className` 决定。链接的 `state` 里放 `{"className":"<要建在的类>"}`，让列表停在那个类，不要带
   `selected`；`draftPath` 同样写相对路径。属性名格式、重名由属主在读者保存时判定，原因显示在字段旁；读者保存后页面选中新属性。

## 设主键、删除

- 设主键用 `setPrimaryKey` 成员的操作，删除用 `remove` 成员的操作，目标是那条属性
  （`{"kind":"object","objectType":"platform:Attribute","primaryKey":"<主键>"}`）。这两个都要读者在对话里确认后才执行。
- 已经是主键的属性不要再设主键；设主键后原来的主键属性不再是主键，确认前告诉读者是哪一条。
- 主键属性、被关系用作关联字段的属性，属主会拒绝删除：把属主给的原因原样转告读者，不要换别的办法绕过去。

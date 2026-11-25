# 四层能力图谱：这一页怎么用

这一页是本体管理器治理层的「能力图谱」，按四层本体（事实 / 能力 / 治理 / 产品）通过官方投影和属主标准读法读取平台已登记的类型、关系种类与当前用户能读到的实例。全部只读：页面上没有任何写对象的操作。

## 页面公开状态

页面地址里的扁平具名查询参数就是这一页写入地址的公开状态，可以还原，也可以由智能体在打开页面时给出（`start`、`selected` 为多类型引用，写成 `className~primaryKey`）：

| 字段 | 含义 | 是否写入地址 |
| --- | --- | --- |
| `mode` | `type`＝类型模式，`instance`＝实例模式（默认） | 是 |
| `view` | 类型模式下的视图：`graph`＝图形（默认），`list`＝按层分组列表 | 是 |
| `start` | 实例模式的起点，一个 `{className, primaryKey}` 对象；为空时以当前用户为起点 | 是 |
| `selected` | 实例模式当前选中的节点；它的全部一跳关系显示在右侧 `relations` 中 | 是 |
| `selectedType` | 当前选中的类型标识（字符串，例如 `platform:Action`），用于图谱节点、对象列表与类详情子表 | 是 |
| `selectedTypeRef` | 与 `selectedType` 双向同步的 `platform:OntologyType` 对象引用，供类型列表、类型选择器与类详情头/摘要使用 | 否 |
| `query` | 单一搜索框关键字（实例模式下由属主按可读范围跨类型检索名称或说明，并在画布上高亮已加载节点；类型模式下实时筛选类型列表并高亮类型节点） | 否 |
| `relationKinds` | 过滤显示的关系种类列表（`platform:OntologyRelationKind` 引用数组；为空时显示全部关系种类） | 否 |
| `visibleLayers` | 画布启用的本体层标识列表（如 `["fact", "capability"]`；为 `null` 时启用全部可用层），与 `graph` 双向同步 | 否 |
| `expandedNodes` | 实例模式中除起点外已展开一跳邻居的节点引用列表，与 `graph` 双向同步，供智能体复现当前子图 | 否 |
| `pickingStart` | 布尔值（默认 `false`），控制类型模式下是否展开「按类型挑选起点」候选区 | 否 |
| `showUserPicker` | 布尔值（默认 `false`），控制实例模式下是否展开「选择起点用户」候选区 | 否 |
| `typeObjectsSearch` | 「按类型挑选起点」对象列表（`typeObjects`）的搜索关键字 | 否 |
| `userPickerSearch` | 「选择起点用户」列表（`userPicker`）的搜索关键字 | 否 |
| `relationKindsSearch` | 关系种类过滤列表（`relationKindFilter`）的搜索关键字 | 否 |

## 页面投影成员

| 成员 | 组件 | 数据来源 | 用途 |
| --- | --- | --- | --- |
| `graph` | `OntologyGraph` | `platform:OntologyType`（`schema`、`counts`、`start`、`neighbors`） | 四层类型图谱与实例一跳展开画布 |
| `typeList` | `ObjectList` | `platform:OntologyType.list` | 类型模式「按层分组」列表视图，按 `layer` 分组展示类型、可读计数/状态徽标与原因 |
| `typePicker` | `ReferencePicker` | `platform:OntologyType.list` | 按类型挑选起点时的可过滤类型下拉选择器（按 `layer` 分组） |
| `typeHeader` | `ObjectHeader` | `platform:OntologyType.record` | 类型模式右侧类详情标题、类型标识、计数状态徽标，并发布 `directoryPath`/`directoryName` 只读输出 |
| `typeSummary` | `ObjectSummary` | `platform:OntologyType.record` | 类详情所属层、可读实例数与说明、一句话定义、创建与使用规则 |
| `typeProperties` | `ObjectList` | `platform:OntologyType.properties` | 选中类型的公开属性表 |
| `typeRelations` | `ObjectList` | `platform:OntologyType.typeRelations` | 选中类型的入向与出向关系表（含存储/推导标识） |
| `typeReads` | `ObjectList` | `platform:OntologyType.reads` | 选中类型登记的具名读法表 |
| `typeOperations` | `ObjectList` | `platform:OntologyType.operations` | 选中类型登记的可发起操作表 |
| `relations` | `ObjectRelations` | `platform:OntologyType.neighbors` | 实例模式右侧一跳关系检视（含关系种类过滤、设为起点、绑定读法/操作标签、摘要与空分组折叠） |
| `relationKindFilter` | `ObjectList` | `platform:OntologyRelationKind.list` | 类型模式图形视图工具栏中的关系种类多选过滤列表（带可辨别名称与端点说明） |
| `typeObjects` | `ObjectList` | `platform:OntologyType.objects` | 按 `selectedType` 列出可读实例，点击即以该对象为起点打开实例模式 |
| `searchResults` | `ObjectList` | `platform:OntologyType.objects`（`platform:OntologyType` 跨类型检索） | 实例模式下跨四层可读对象搜索结果列表，点选命中项即收起无关节点并聚焦该节点及其一跳邻居 |
| `userPicker` | `ObjectList` | `platform:OntologyType.objects`（固定 `platform:User`） | 切换实例模式的起点用户 |

## 看四层平台类详情

1. 切到**类型模式**（顶部模式切换，或由智能体带 `?mode=type` 打开本页）。
2. 在图形（`graph`）里点一个类型节点，或切到**按层分组**（`typeList`）点一行——两种视图通过 `selectedType` / `selectedTypeRef` 共用同一个选中类型，右侧显示同一份只读类详情。
3. 类详情由 `typeHeader`、`typeSummary` 以及 `typeProperties`、`typeRelations`、`typeReads`、`typeOperations` 四个官方列表投影组成，展示名称、类型标识、所属层、可读实例数与状态、一句话定义、创建与使用规则、公开属性、入向与出向关系、具名读法与可发起的操作。

类型节点与列表里的数字是当前用户本人能读到的实例数。显示「无权限」表示该类型的读取被属主拒绝，显示「读取失败」表示属主读取出错，显示「尚未接入」表示属主端点还没接上——都不是 0。

## 从类到实例

- **看实例**：当 `typeHeader` 的属主只读输出 `directoryPath` 非空时（产品层五类：基础组件、投影、面板、应用、智能体），类详情操作栏显示「看实例」按钮；点击后跳转到 `directoryPath`。对应目录在部署里尚未接入或当前用户无入口准入时，页面顶部会给出可关闭的提示，页面本身照常可用。
- **选一个作图谱起点**：类详情里点「选一个作图谱起点」，下方展开 `typePicker` 与 `typeObjects`，可按关键字过滤、翻页挑一个对象；选中后自动切到实例模式，并以该对象作为起点展开一跳关系。

## 实例模式里换起点

三种换法都可同时用：

1. 右侧「起点」里的「切换起点用户」，展开 `userPicker`（`showUserPicker: true`）挑一个可读用户；
2. 选中图上任意节点后，点顶部「以选中节点为起点」，或在右侧 `relations` 里对任意对端节点点「设为起点」（即使该对端原本就是当前起点，也会把右侧选中切回该起点并保持实例模式）；
3. 右侧「按类型挑选起点」里用按层分组的 `typePicker` 选类型、在 `typeObjects` 里挑对象（类型模式下点「选一个作图谱起点」将 `pickingStart` 置为 `true` 后也是这一处）。

自定义起点时，右侧「起点」区直接展示 `graph` 发布的 `startLabel`（名称）与 `startDetail`（类型与主键），同名对象始终可区分。点「回到当前用户」清掉 `start`、`selected` 与 `expandedNodes`，重新以当前登录用户为起点。

## 图上画什么、怎么筛

- 实线是明确存储的引用关系（含「发布了」），虚线是能从记录推导出来的关系。
- 画布上方的层筛选按事实 / 能力 / 治理 / 产品开关，与公开状态 `visibleLayers` 双向联动；图例只统计当前已画出的节点；同一层重新打开时会补读这一层的关系。
- 类型模式图形视图工具栏中的「关系种类」筛选（`relationKindFilter`）与实例模式右侧 `relations` 内的关系种类过滤共用 `relationKinds` 状态，与 `graph` 双向联动；类型模式工具栏收起态同时展示已选关系种类名称标签与一键清除按钮。
- 「没有邻居」「无权读取某类关系」「读取失败」「尚未接入」分别显示，互不合并：某个关系被属主拒绝，不影响同一节点其他关系照常显示；零条边的正常关系组会折叠为计数提示。

## 搜索行为

- 工具栏提供带搜索图标与内置清除按钮的单一搜索框（`query`）。
- 在实例模式下，输入关键字后由属主按当前读者的可读范围跨四层类型检索名称或说明（`searchResults`），同时在画布上高亮已加载节点；点击任意命中项将收起无关节点（清空 `expandedNodes`），直接以该命中节点为起点聚焦其一跳邻居。
- 在类型模式下，同一个搜索框会对「按层分组」列表视图按名称、标识与说明实时筛选，并在类型画布上高亮匹配的类型节点。
- 仍保留逐跳探索与右侧「切换起点用户 / 按类型挑选起点」的完整能力。

## 选中节点与关系检视

选中图上任意节点（包括投影、面板这类绑定平台类型的节点）后，右侧 `relations` 按关系种类分组列出它的全部入向与出向一跳关系：方向、存储/推导、对端对象与对端类型；关系带有绑定信息时一并显示绑定的读法、操作与经输入绑定标签。点对端名字可以切换 `selected`，点「设为起点」会把 `start` 与 `selected` 同步设为该对端节点并清空 `expandedNodes`，重新展开它的一跳关系（即使该对端原本已是 `start`，也会把右侧选中切回该起点）。

## 智能体可以怎么做

- 读当前状态或直达视图：模式、视图、起点、选中节点、选中类型以扁平具名参数写在地址里，打开页面时可带上参数（例如 `?mode=type&view=list&selectedType=platform:Action` 或 `?mode=instance&start=platform:User~u-1&selected=platform:Action~act-1`）。同时设置 `start` 与 `selected` 时不会互相覆盖；若仅传 `selected=B`（未传 `start`），右侧 `relations` 会直接查 `B` 的关系，画布仅在 `B` 已处于当前子图内时才会居中聚焦 `B`——要在画布上聚焦多跳外的对象，请同时设 `start=B`，或经 `expandedNodes` 逐跳展开。
- 操控筛选、展开与候选区：在已打开的页面上调用 `present({ target, state })` 可按需更新任意公开状态，例如切换层筛选（`visibleLayers: ["fact", "capability"]`）、展开指定节点的一跳邻居（`expandedNodes: [{ className, primaryKey }]`）、在实例模式下展开用户候选并搜索（`showUserPicker: true, userPickerSearch: "Alice"`）、在类型模式下展开按类型挑选起点并过滤对象（`pickingStart: true, selectedType: "platform:Action", typeObjectsSearch: "Refund"`），或过滤关系种类候选（`relationKindsSearch: "binds"`）。只改 `start` 而不同时指定 `selected` 时，`selected` 会同步跟到新起点（清空 `start: null` 时同步清空 `selected`）。
- 清除状态：在已打开的页面上调 `present({ target, state })` 只修改本次传入的字段；要清除 `selected`、`start`、`relationKinds`、`visibleLayers` 或 `expandedNodes`，必须明确传 `null`（省略参数仅在新开裸地址时采用默认值）。
- 刷新数据可点击页头右上角的刷新按钮，重新拉取全部投影数据。

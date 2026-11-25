# 把已经写好的页面搬进产品层

手里已经有一张现成页面（例如旧业务系统页面、前端原型或独立 Vue 页面），要把它搬进 Ontomato 产品层变成标准面板应用时，按这篇指南一步步做。

核心目标只有一条：**搬完以后，人能看到的内容、能做的操作不丢，同时智能体能用同一份表单、同一个按钮、同一个接口、同一份权限操作这张页面。**

---

## 1. 原页面在这件事里是什么

原页面是**做成什么样的依据**，不是拿来直接复制粘贴的源代码。

动手写代码之前，先把原页面翻成两张清单（搬完后逐项打钩验收）：

1. **可见业务内容清单**：页面上每一块展示给人的业务数据是什么（列表有哪些列、汇总数字有哪些、详情有哪些卡片/字段、图表画什么、不同角色看得到/看不到什么）。
2. **可执行操作清单**：人在页面上能点的每一个动作是什么（筛选、切页签、跳详情、新建、编辑保存、删除、审批、批量操作等，以及哪些需要确认）。

> 只搬原页面现在真在用的内容和操作，不为将来提前补功能，也不丢掉原页面已有的关键操作。

---

## 2. 哪些能搬，哪些不能照搬

| 类别 | 能不能搬 | 怎么做 |
| --- | --- | --- |
| 页面排布结构（两栏卡片、工具条、页头位置、弹窗骨架） | **能搬** | 用标准 HTML、Flex/Grid 与 CSS `@container` 容器查询重排；改用平台设计变量（`--sdk-*`、`--spacing-*`、`--page-gutter`、`--page-content-gap`），不要按 `window.innerWidth` 或固定窗口高度减法写死。 |
| 静态文案、分组标题、说明提示、纯样式修饰 | **能搬** | 直接留在 `panel.html`（多语言放 `panel.json` 的 `content.messages`），无需登记投影。 |
| 自己 `fetch` / `axios` / `XMLHttpRequest` 请求业务接口 | **不能照搬** | 全部删掉。读数据走投影声明的读法，改数据走投影声明的已登记操作；`panel check` 会直接拦住直接网络调用。 |
| 在前端自己求和、计数、拼业务结论（如“超过 3 天判超期”） | **不能照搬** | 全部移到能力层（指标 `MetricView` 或动作 `Action`）。组件只负责格式化已提供的值，不产出新的业务结论。 |
| 在面板里直接手画 `<table>`、卡片、表单并读记录字段 | **不能照搬** | 改放官方基础组件投影（`ObjectList`、`ObjectSummary`、`ObjectForm`、`ObjectHeader`、`ObjectRefCard`、`MetricCard`、`RecordTemplate`、`ObjectGraph` 等）。 |
| 直接写第三方 UI 库标签或变量（`el-*`、`--el-*`、`v-loading`、`element-plus`） | **不能照搬** | 换成平台官方无数据界面件（`<page-header>`、`<sdk-*>`、`v-sdk-*`、`--sdk-*`）。 |

---

## 3. 清单里的每一项如何落到产品层

先把可见内容和操作清单逐项映射到产品层与能力层，再运行 `node "$SKILL/scripts/ontomato.mjs" panel type <类型ID>` 核对平台和本体里已有的读法与操作：

| 原页面上的东西 | 落到产品层的哪里 |
| --- | --- |
| **列表、详情、表单（客户业务类，如 `Student`、`Order`）** | 投影绑定平台通用读函数：`query`（分页列表）、`record`（单条详情）、`form`（编辑表单）、`createForm`（新建表单）。注意组件目录里的 `bindsElement` 只表示适用类型，实际绑定必须经由读法或操作，单写类登记不过。 |
| **平台对象（如 `platform:Relationship`、`platform:Application`）** | 投影绑定平台内置读法与管理操作。 |
| **带口径的统计数、汇总句、状态判断结论** | 能力层建指标 `MetricView`（读）或动作 `Action`（写）。指标在定义里写清 `sourceObjectTypes`，写操作完成后平台按影响范围自动刷新指标投影。组件只做三种格式化：① `RecordTemplate` 把指标/记录已给的数字填进固定句式（如 `共 {total} 人，其中 {pending} 人待审`）；② `TypedValue` / `InfoBanner` / `ObjectList` 列用精确匹配 `valueMap` 把原始枚举映射成文字、颜色和图标；③ `ObjectList` 在**完整未分页**列表上做本地纯文字匹配并输出 `filteredCount`（分页列表的总数必须用拥有者返回的 `total`，缺时为 `null`，不能拿已加载行数冒充）。 |
| **编辑保存、删除、审批、新建、全局批量动作** | 绑定能力层已发布的 `Action` 或平台内置操作。编辑表单绑定目标动作时，动作参数必须覆盖想让人编辑的全部属性（支持同名直连、`{ "formField": "/pointer" }` 改名/嵌套路径、`{ "formFields": { "k": "/pointer" } }` 装入 JSON 参数；动作不接的属性自动只读）。新建或全局操作绑定**无目标动作**（`target: { source: "none" }`，调用时 `target: null`；运行 `panel type <类型ID>` 会直接在 `targetlessOperations` 中列出 `affects` 包含该类型的无目标动作，运行 `panel type --all` 可查看全部顶层无目标动作）。 |
| **原页面要的能力在本体里还没有** | 由业务/能力拥有者在能力层补读法、指标、表单字段或动作；不要在面板脚本里绕路拼接或前端兜底。 |

> **当前能力边界（客户类表单与无目标动作，搬页设计前务必知晓）**
> 1. **受限数据范围角色无法执行无目标新建**：若角色对该无目标新建动作仅授权了受限数据范围，人和智能体执行都会被属主统一拒绝（`ACTION_TARGET_OUT_OF_SCOPE`），两边行为一致。
> 2. **未声明 `affects` 不会自动刷新列表**：无目标新建动作没有声明影响范围（`affects`）时，新建成功后名册列表与关联指标不会自动刷新；请务必在动作定义里声明 `affects`。
> 3. **无目标动作不会从普通文本结果自动选中新对象**：即使无目标客户动作在普通 `result` 文本里返回了新学号或主键，当前适配器固定返回 `affected.objects: []`，保存后不会自动选中或跳转新对象（按“提示成功、关闭/清空新建表单、靠 `affects` 自动刷新列表”收尾即可）。
> 4. **清空文本字段暂无法区分 `NULL` 与 `""`**：需要区分数据库 `NULL` 和空字符串 `""` 的文本字段，当前清空接法统一提交 `""`，暂无法区分两者。

---

## 4. 状态归哪里：公开状态 vs. `deepLink` vs. Vue 私有状态

| 原页面里的状态 | 放哪里 | 是否标 `deepLink: true` | 说明 |
| --- | --- | --- | --- |
| 当前选中的对象（`selected`） | `manifest.state` | **是** | 别人打开链接要回到同一条记录。单类对象自动编码为 `?selected=<pk>`，多类 `object-union` 为 `?selected=<class>~<pk>`。 |
| 页签（`tab`）、视图模式、搜索词（`search`）、筛选（`status`/`scope`）、排序（`sort`） | `manifest.state` | **是** | 决定读者看到哪一部分业务内容，也属于回到同一视图所需状态。 |
| 新建弹窗开关（`creating`）、授权弹窗（`grantDialog`）、正在编辑哪一条（`editingEntryId`）、`dialog`、`compose` | `manifest.state` | **严禁标 `deepLink: true`** | 必须声明为公开状态，好让智能体也能打开弹窗/切换表单；但绝不能写进 URL。 |
| 悬停高亮、帮助提示展开收起、滚动条位置、纯动画状态 | Vue `ref` / `reactive` | 不适用 | 不改变业务内容，也不需要智能体控制，留在组件内部即可。 |

> 面板要用投影算好的只读信号（如选中的名称、列表 `total` / `loadedCount` / `filteredCount`、表单 `dirty`、属主声明的具名标量输出）时，用 `usePanelOutput(member, name)` 读取，不要建成可写公开状态。判断“有没有、是不是、是否为零”来控制 `v-if` 显隐，不属于业务计算。

---

## 5. 选组件的四步顺序

每搬一块界面，严格按下面顺序走，前一步接得住就不要跳到下一步：

1. **官方组件默认外观**：先放 `<projection>` 接好 `data`、`target` 和 `state`，看默认效果是否已经够用。
2. **官方组件 `config` 配置**：配列宽/类型/精确 `valueMap`、`ObjectList` 的 `config.rowActions`（内置行操作列与更多菜单）、`ObjectSummary` 的 `fields`/`copyableFields`、`ObjectForm` 的 `presentation`（`cards` / `tabs` / `steps`）与 `groups`、`OperationButton` 的 `label`/`type`/`hideWhenUnavailable: true`。
3. **官方组件 Vue 插槽**：只有某一格、某一展开行或某一个表单字段配不出来时，才在 `#cell-<key>`、`#actions`、`#row-detail`、`#field-<dotPath>` 里放其他组件：
   - 只展示官方组件传入的 `value`/`displayText`/`tone` 的小部件：用 `component register` 登记后在 `manifest.components` 声明，不登记投影；
   - 需要另外读取本体数据的区域（例如展开行详情）：放成投影成员（`target: { fromSlot: true }`），在插槽里通过 `<projection slot="rowDetail" :inputs="{ target: ref }">` 接入；
   - 注意：`ObjectList` 插槽绝不传整行原始记录，不要在模板里读记录字段或做计算。
4. **自写整块组件并登记（最后手段）**：前 3 步都接不住时，才写一个独立域内组件并用 `node "$SKILL/scripts/ontomato.mjs" component register <目录>` 登记，写清 `meaning`、数据口、配置、输入输出与操作。绝不要把整张页面包成一个大组件。

---

## 6. 按钮分工：什么时候直接写，什么时候放投影

按钮只有三类，一眼分清：

1. **纯页面交互按钮**（打开新建弹窗、切换页签/视图、返回目录、跳转到别的入口、放弃未保存草稿、刷新视图）：直接写 `<sdk-button>`，不登记投影。
2. **直接发起业务修改的按钮**（删除、审批、发布、停用、无目标创建按钮）：放 `OperationButton` 投影，或在 `ObjectList` 的 `config.rowActions` / `ObjectHeader` 的 `operations` 中声明，统一走平台确认、权限判定和自动刷新。
3. **表单的保存与放弃**：放 `ObjectForm` 自带操作栏（`config.actions: "footer" | "create-only"`），或通过 `usePanelFormDraft("form")` 接到 `<page-header :draft="formDraft">`（不要为页头保存另建一个独立投影）。如果另一个成员上的写操作要提交某张表单正在填的内容，在声明里显式写 `draft: "<表单成员名>"`。

---

## 7. 搬进来挂在哪里：入口、准入与外框

- **登记入口（`registration.json`）**：
  - 应用 ID 必须以 `app-` 开头，入口路径以 `/applications/<app-id>/` 开头。
  - 每个入口在 `panelUses` 中分配域内唯一的 `pageKey`；出现在应用菜单里的入口填写 `names`，详情页这类靠跳转或深链打开的入口**省略 `names`**。
  - 入口之间跳转统一用 `@ontomato/sdk/panel` 的 `panelAddress(DETAIL_PATH, { selected: ref.primaryKey })` 生成扁平具名参数链接。
- **准入规则**：`entryAccess` 和每条 `panelUses[].access` 只写两种——本域成员都能进（`{ "kind": "domain-member" }`），或使用**本应用自己声明**的权限码（`{ "permissionCode": "app:<app-id>:..." }`），不要借用别的应用的权限码。
- **外框面板**：不自写外框时，平台自动套用通用外框面板渲染应用菜单；只有多个入口需要共享外框级上下文（如全局“当前学期”切换）时，才自写应用外框面板，外框里标 `deepLink: true` 的状态会自动以 `frame.<name>` 形式出现在 URL 中。对话旁打开时不画外框，直接显示入口面板。

---

## 8. 怎么确认搬对了

按下面五步逐项核验，全部通过才算搬完：

1. **静态检查通过**：运行 `node "$SKILL/scripts/ontomato.mjs" panel check <面板目录>`，无结构错误、无第三方组件/样式违规、无直调接口报错、无未解析引用。
2. **登记并强制刷新**：运行 `node "$SKILL/scripts/ontomato.mjs" panel register <面板目录>`，打开目标入口并强制刷新页面。
3. **逐项对照原页面清单**：拿着第 1 步列的“可见业务内容清单”和“可执行操作清单”，逐条验证在真实数据下都能看到、都能点通、且无权限时会被拥有者正确拒绝或隐藏。
4. **双宽度检查**：同时在**整页宽度**和**对话旁窄宽度**下查看，确认无横向溢出、两栏自动折叠、弹窗可滚动、没有多余空白。
5. **对话旁实测智能体五件事**：把页面开在对话旁，依次让助手做：
   - **看见**：问“当前打开的是哪张页、选中了谁、当前页签/筛选是什么、表单里填了什么”，回答准确；
   - **跳转**：让助手切到另一条记录或另一个入口，当轮立刻切换且地址栏更新为扁平参数；
   - **改状态**：让助手切换页签/筛选或打开新建弹窗，当轮立刻生效、不整页刷新、不触发业务写入；
   - **填表**：让助手把某个字段改成新值但不保存，验证助手直接把草稿填进正在打开的同一份表单、标出改动字段、保持未保存、离开页面有未保存提示；若人已经改了未保存内容，助手先询问是否覆盖而不是悄悄盖掉；
   - **保存/执行**：由人点击保存或让助手发起保存/删除，默认弹出确认（等待期间人改了表单则旧确认失效），成功后列表和受影响指标自动刷新。

---

## 9. 常见错法速查表

| 常见错法 | 为什么不行 | 正确做法 |
| --- | --- | --- |
| 换路按字段名取记录值（如在模板里读原始记录字段） | 绕过投影声明，字段不可追溯，智能体也不认 | 放投影由官方或登记组件渲染；面板脚本只通过 `usePanelOutput` 读取已声明的只读输出 |
| 前端对列表求和、数 `rows.length` 当分页总数，或在组件里写“超过 3 天判超期” | 把业务逻辑和口径藏进界面，分页下数字必错 | 统计与业务结论归能力层指标/动作；分页总数严格用 `usePanelOutput("list", "total")`（缺时为 `null`） |
| 把整行记录传进单元格插槽自己画，或在插槽模板里算数 | 破坏行数据边界，无法复用与审计 | `ObjectList` 插槽只收当前列 `value` / `displayText` / `tone`，只做展示；需要行详情另放嵌套投影接 `:inputs="{ target: ref }"` |
| 页签、筛选、新建弹窗开关只留在 Vue 私有 `ref` 里 | 智能体看不见也切不动，人和智能体脱节 | 决定看到哪部分业务内容或打开业务表单的状态，一律声明进 `manifest.state` |
| 把 `creating`、`editingEntryId`、`grantDialog` 标成 `deepLink: true` | 链接里带出瞬时弹窗/编辑态，分享出去一打开就弹框 | 只有“回到同一视图”所需状态才标 `deepLink: true`；弹窗和正在编辑状态保持公开但不进地址 |
| 打开页面或选中记录时自动调用写操作（例如自动标“已读”） | 违反“展示不触发写入”，刷新或智能体浏览会悄悄改库 | 写入只在用户明确点击或智能体明确调用已登记操作时发生 |
| 客户类编辑表单里某些字段变只读，以为组件坏了 | 客户类表单只允许编辑所绑保存 `Action` 接收的字段 | 检查保存 `Action` 参数是否覆盖目标属性，同名直连或用 `{ "formField": "/pointer" }` / `{ "formFields": { ... } }` 补齐接线 |
| 新建动作没有返回新对象标识，却从刷新后的列表里猜最后一行当新对象并跳转 | 并发或排序变化时会跳错对象 | 动作返回新标识才跳转；未返回时提示成功、关闭/清空新建弹窗、靠 `affects` 自动刷新列表，需要直跳详情请能力方返回新标识 |
| 给列表未绑定可写公开选中状态（或绑固定字面量）却指望整行可点选 | 选中态不可写时列表禁止私有选中 | 绑定可写公开状态 `state: { selected: "selected" }`，或用 `@choose` 跳转到详情入口 |

---

## 10. 完整对照示例：搬之前 → 搬之后（学员名册与维护）

下面演示如何把一张常见的旧 Vue 业务页（**学员名册 + 待审统计 + 详情编辑 + 新建弹窗 + 删除**）搬进产品层。

### 搬之前（旧独立 Vue 页面，存在多项违规）

```html
<!-- ❌ 旧写法：直调接口、前端算待审数、手画表格、私有状态、无确认直接提交 -->
<script setup>
import { ref, computed, onMounted } from "vue";
const students = ref([]);
const selected = ref(null);
const showCreate = ref(false);          // ❌ 私有状态，智能体打不开
const statusFilter = ref("all");        // ❌ 私有状态，既不能分享也不可控

onMounted(async () => {
  const res = await fetch("/api/students"); // ❌ 直接请求业务接口
  students.value = await res.json();
});

// ❌ 前端自己数待审人数并拼句
const summaryText = computed(() => {
  const pending = students.value.filter(s => s.reviewStatus === "pending").length;
  return `共 ${students.value.length} 人，其中 ${pending} 人待审`;
});

async function saveStudent(form) {
  await fetch(`/api/students/${form.id}`, { method: "POST", body: JSON.stringify(form) }); // ❌ 直调写接口
}
</script>

<template>
  <!-- ❌ 使用第三方 el-* 组件，且手画表格直接读记录字段 -->
  <div class="header">
    <span>{{ summaryText }}</span>
    <el-button type="primary" @click="showCreate = true">新建学员</el-button>
  </div>
  <el-table :data="students" @row-click="row => selected = row">
    <el-table-column prop="name" label="姓名" />
    <el-table-column label="审核状态">
      <template #default="{ row }">
        <!-- ❌ 前端自己写业务判断 -->
        <el-tag :type="row.pendingDays > 3 ? 'danger' : 'success'">{{ row.reviewStatus }}</el-tag>
      </template>
    </el-table-column>
  </el-table>
</template>
```

### 搬之后

以[左列表与详情编辑模板](templates/list-detail-edit/README.md)为起点。选中学员、搜索词和编辑模式放在公开状态里，
地址只恢复选中学员和搜索词。列表和详情读法归学员类，新增与保存接到它的具名动作。学员找不到或无权读取时，
由详情头部原位显示原因。切换学员或新建前先确认未保存的修改。

待审数用由属主定义口径的指标投影显示。删除如需加入页面，绑定本域的删除动作和选中学员，使用
[操作按钮](panel-authoring/recipes/invoke-owner-operations.md)（组件单页 `sdk read docs/components/OperationButton.md`）展示是否可以执行。写入成功后平台依据操作声明的影响重读。

在对话旁验证 `present` 能打开指定学员和编辑模式，`fill_form` 能填入挂载的表单并保留待确认的改动，
`page_action` 能通过同一个保存入口发起用户确认。关闭编辑时卸载表单。列表仅被详情盖住时保留挂载。

/*
 * Single source of truth mapping public Ontomato SDK UI names to their underlying implementation:
 * - UI primitive components (`<sdk-*>` / `Sdk*` from `@ontomato/sdk/ui`)
 * - UI directives (`v-sdk-*` / `vSdk*`, registered directly with `app.directive(...)`, not `app.use(...)`)
 * - Author-facing theme variables (`--sdk-*` and platform design tokens)
 * - Renamed SDK exports that no longer expose implementation library names (e.g. `InteractiveGraphCanvas`)
 *
 * Template registration, script entry generation, component catalogue, skills and static checks all read this table so
 * no second hand-maintained mapping exists. Underlying component objects and their `.name` stay intact; the SDK binds
 * and exports them under the SDK names declared here.
 */

export const SDK_UI_ENTRY_SPECIFIER = "@ontomato/sdk/ui" as const;

export interface SdkUiComponentMapping {
  readonly sdkTag: `sdk-${string}`;
  readonly sdkExport: `Sdk${string}`;
  readonly implTag: `el-${string}`;
  readonly implExport: `El${string}`;
  /** Subpath under `element-plus/es/components/<implSubpath>/index`. */
  readonly implSubpath: string;
}

export interface SdkUiForbiddenComponent {
  readonly implTag?: `el-${string}`;
  readonly implExport: `El${string}`;
  readonly replacement: string;
}

export interface SdkUiDirectiveMapping {
  /** Vue template directive name (`v-sdk-*`). Registered via `app.directive(name.slice(2), directive)`. */
  readonly sdkName: `v-sdk-${string}`;
  /** Named export from `@ontomato/sdk/ui`. */
  readonly sdkExport: `vSdk${string}`;
  readonly implName: `v-${string}`;
  readonly implExport: string;
  readonly implSubpath: string;
  readonly description: string;
}

export type SdkThemeTokenKind = "color" | "length" | "elevation" | "font" | "shadow";

export interface SdkThemeTokenMapping {
  readonly sdk: `--${string}`;
  readonly impl: `--el-${string}`;
  readonly kind: SdkThemeTokenKind;
  readonly overridable: boolean;
}

export interface SdkThemeTokenAlias {
  readonly impl: `--el-${string}`;
  readonly replacement: `--${string}`;
}

export interface SdkPlatformThemeToken {
  readonly name: `--${string}`;
  readonly kind: SdkThemeTokenKind;
  readonly overridable: boolean;
}

export interface SdkRenamedExportMapping {
  readonly implExport: string;
  readonly implTag: string;
  readonly sdkExport: string;
  readonly sdkTag: string;
  readonly module: string;
}

/** Supported UI primitive components exposed under `<sdk-*>` and `@ontomato/sdk/ui`. */
export const SDK_UI_COMPONENTS: readonly SdkUiComponentMapping[] = [
  { sdkTag: "sdk-affix", sdkExport: "SdkAffix", implTag: "el-affix", implExport: "ElAffix", implSubpath: "affix" },
  { sdkTag: "sdk-alert", sdkExport: "SdkAlert", implTag: "el-alert", implExport: "ElAlert", implSubpath: "alert" },
  { sdkTag: "sdk-anchor", sdkExport: "SdkAnchor", implTag: "el-anchor", implExport: "ElAnchor", implSubpath: "anchor" },
  { sdkTag: "sdk-anchor-link", sdkExport: "SdkAnchorLink", implTag: "el-anchor-link", implExport: "ElAnchorLink", implSubpath: "anchor" },
  { sdkTag: "sdk-aside", sdkExport: "SdkAside", implTag: "el-aside", implExport: "ElAside", implSubpath: "container" },
  { sdkTag: "sdk-auto-resizer", sdkExport: "SdkAutoResizer", implTag: "el-auto-resizer", implExport: "ElAutoResizer", implSubpath: "table-v2" },
  { sdkTag: "sdk-autocomplete", sdkExport: "SdkAutocomplete", implTag: "el-autocomplete", implExport: "ElAutocomplete", implSubpath: "autocomplete" },
  { sdkTag: "sdk-avatar", sdkExport: "SdkAvatar", implTag: "el-avatar", implExport: "ElAvatar", implSubpath: "avatar" },
  { sdkTag: "sdk-avatar-group", sdkExport: "SdkAvatarGroup", implTag: "el-avatar-group", implExport: "ElAvatarGroup", implSubpath: "avatar" },
  { sdkTag: "sdk-backtop", sdkExport: "SdkBacktop", implTag: "el-backtop", implExport: "ElBacktop", implSubpath: "backtop" },
  { sdkTag: "sdk-badge", sdkExport: "SdkBadge", implTag: "el-badge", implExport: "ElBadge", implSubpath: "badge" },
  { sdkTag: "sdk-breadcrumb", sdkExport: "SdkBreadcrumb", implTag: "el-breadcrumb", implExport: "ElBreadcrumb", implSubpath: "breadcrumb" },
  { sdkTag: "sdk-breadcrumb-item", sdkExport: "SdkBreadcrumbItem", implTag: "el-breadcrumb-item", implExport: "ElBreadcrumbItem", implSubpath: "breadcrumb" },
  { sdkTag: "sdk-button", sdkExport: "SdkButton", implTag: "el-button", implExport: "ElButton", implSubpath: "button" },
  { sdkTag: "sdk-button-group", sdkExport: "SdkButtonGroup", implTag: "el-button-group", implExport: "ElButtonGroup", implSubpath: "button" },
  { sdkTag: "sdk-calendar", sdkExport: "SdkCalendar", implTag: "el-calendar", implExport: "ElCalendar", implSubpath: "calendar" },
  { sdkTag: "sdk-card", sdkExport: "SdkCard", implTag: "el-card", implExport: "ElCard", implSubpath: "card" },
  { sdkTag: "sdk-carousel", sdkExport: "SdkCarousel", implTag: "el-carousel", implExport: "ElCarousel", implSubpath: "carousel" },
  { sdkTag: "sdk-carousel-item", sdkExport: "SdkCarouselItem", implTag: "el-carousel-item", implExport: "ElCarouselItem", implSubpath: "carousel" },
  { sdkTag: "sdk-cascader", sdkExport: "SdkCascader", implTag: "el-cascader", implExport: "ElCascader", implSubpath: "cascader" },
  { sdkTag: "sdk-cascader-panel", sdkExport: "SdkCascaderPanel", implTag: "el-cascader-panel", implExport: "ElCascaderPanel", implSubpath: "cascader-panel" },
  { sdkTag: "sdk-check-tag", sdkExport: "SdkCheckTag", implTag: "el-check-tag", implExport: "ElCheckTag", implSubpath: "check-tag" },
  { sdkTag: "sdk-checkbox", sdkExport: "SdkCheckbox", implTag: "el-checkbox", implExport: "ElCheckbox", implSubpath: "checkbox" },
  { sdkTag: "sdk-checkbox-button", sdkExport: "SdkCheckboxButton", implTag: "el-checkbox-button", implExport: "ElCheckboxButton", implSubpath: "checkbox" },
  { sdkTag: "sdk-checkbox-group", sdkExport: "SdkCheckboxGroup", implTag: "el-checkbox-group", implExport: "ElCheckboxGroup", implSubpath: "checkbox" },
  { sdkTag: "sdk-col", sdkExport: "SdkCol", implTag: "el-col", implExport: "ElCol", implSubpath: "col" },
  { sdkTag: "sdk-collapse", sdkExport: "SdkCollapse", implTag: "el-collapse", implExport: "ElCollapse", implSubpath: "collapse" },
  { sdkTag: "sdk-collapse-item", sdkExport: "SdkCollapseItem", implTag: "el-collapse-item", implExport: "ElCollapseItem", implSubpath: "collapse" },
  { sdkTag: "sdk-collapse-transition", sdkExport: "SdkCollapseTransition", implTag: "el-collapse-transition", implExport: "ElCollapseTransition", implSubpath: "collapse-transition" },
  { sdkTag: "sdk-color-picker", sdkExport: "SdkColorPicker", implTag: "el-color-picker", implExport: "ElColorPicker", implSubpath: "color-picker" },
  { sdkTag: "sdk-color-picker-panel", sdkExport: "SdkColorPickerPanel", implTag: "el-color-picker-panel", implExport: "ElColorPickerPanel", implSubpath: "color-picker-panel" },
  { sdkTag: "sdk-container", sdkExport: "SdkContainer", implTag: "el-container", implExport: "ElContainer", implSubpath: "container" },
  { sdkTag: "sdk-countdown", sdkExport: "SdkCountdown", implTag: "el-countdown", implExport: "ElCountdown", implSubpath: "countdown" },
  { sdkTag: "sdk-date-picker", sdkExport: "SdkDatePicker", implTag: "el-date-picker", implExport: "ElDatePicker", implSubpath: "date-picker" },
  { sdkTag: "sdk-date-picker-panel", sdkExport: "SdkDatePickerPanel", implTag: "el-date-picker-panel", implExport: "ElDatePickerPanel", implSubpath: "date-picker-panel" },
  { sdkTag: "sdk-descriptions", sdkExport: "SdkDescriptions", implTag: "el-descriptions", implExport: "ElDescriptions", implSubpath: "descriptions" },
  { sdkTag: "sdk-descriptions-item", sdkExport: "SdkDescriptionsItem", implTag: "el-descriptions-item", implExport: "ElDescriptionsItem", implSubpath: "descriptions" },
  { sdkTag: "sdk-dialog", sdkExport: "SdkDialog", implTag: "el-dialog", implExport: "ElDialog", implSubpath: "dialog" },
  { sdkTag: "sdk-divider", sdkExport: "SdkDivider", implTag: "el-divider", implExport: "ElDivider", implSubpath: "divider" },
  { sdkTag: "sdk-drawer", sdkExport: "SdkDrawer", implTag: "el-drawer", implExport: "ElDrawer", implSubpath: "drawer" },
  { sdkTag: "sdk-dropdown", sdkExport: "SdkDropdown", implTag: "el-dropdown", implExport: "ElDropdown", implSubpath: "dropdown" },
  { sdkTag: "sdk-dropdown-item", sdkExport: "SdkDropdownItem", implTag: "el-dropdown-item", implExport: "ElDropdownItem", implSubpath: "dropdown" },
  { sdkTag: "sdk-dropdown-menu", sdkExport: "SdkDropdownMenu", implTag: "el-dropdown-menu", implExport: "ElDropdownMenu", implSubpath: "dropdown" },
  { sdkTag: "sdk-empty", sdkExport: "SdkEmpty", implTag: "el-empty", implExport: "ElEmpty", implSubpath: "empty" },
  { sdkTag: "sdk-footer", sdkExport: "SdkFooter", implTag: "el-footer", implExport: "ElFooter", implSubpath: "container" },
  { sdkTag: "sdk-form", sdkExport: "SdkForm", implTag: "el-form", implExport: "ElForm", implSubpath: "form" },
  { sdkTag: "sdk-form-item", sdkExport: "SdkFormItem", implTag: "el-form-item", implExport: "ElFormItem", implSubpath: "form" },
  { sdkTag: "sdk-header", sdkExport: "SdkHeader", implTag: "el-header", implExport: "ElHeader", implSubpath: "container" },
  { sdkTag: "sdk-icon", sdkExport: "SdkIcon", implTag: "el-icon", implExport: "ElIcon", implSubpath: "icon" },
  { sdkTag: "sdk-image", sdkExport: "SdkImage", implTag: "el-image", implExport: "ElImage", implSubpath: "image" },
  { sdkTag: "sdk-image-viewer", sdkExport: "SdkImageViewer", implTag: "el-image-viewer", implExport: "ElImageViewer", implSubpath: "image-viewer" },
  { sdkTag: "sdk-input", sdkExport: "SdkInput", implTag: "el-input", implExport: "ElInput", implSubpath: "input" },
  { sdkTag: "sdk-input-number", sdkExport: "SdkInputNumber", implTag: "el-input-number", implExport: "ElInputNumber", implSubpath: "input-number" },
  { sdkTag: "sdk-input-tag", sdkExport: "SdkInputTag", implTag: "el-input-tag", implExport: "ElInputTag", implSubpath: "input-tag" },
  { sdkTag: "sdk-link", sdkExport: "SdkLink", implTag: "el-link", implExport: "ElLink", implSubpath: "link" },
  { sdkTag: "sdk-main", sdkExport: "SdkMain", implTag: "el-main", implExport: "ElMain", implSubpath: "container" },
  { sdkTag: "sdk-mention", sdkExport: "SdkMention", implTag: "el-mention", implExport: "ElMention", implSubpath: "mention" },
  { sdkTag: "sdk-menu", sdkExport: "SdkMenu", implTag: "el-menu", implExport: "ElMenu", implSubpath: "menu" },
  { sdkTag: "sdk-menu-item", sdkExport: "SdkMenuItem", implTag: "el-menu-item", implExport: "ElMenuItem", implSubpath: "menu" },
  { sdkTag: "sdk-menu-item-group", sdkExport: "SdkMenuItemGroup", implTag: "el-menu-item-group", implExport: "ElMenuItemGroup", implSubpath: "menu" },
  { sdkTag: "sdk-option", sdkExport: "SdkOption", implTag: "el-option", implExport: "ElOption", implSubpath: "select" },
  { sdkTag: "sdk-option-group", sdkExport: "SdkOptionGroup", implTag: "el-option-group", implExport: "ElOptionGroup", implSubpath: "select" },
  { sdkTag: "sdk-pagination", sdkExport: "SdkPagination", implTag: "el-pagination", implExport: "ElPagination", implSubpath: "pagination" },
  { sdkTag: "sdk-popover", sdkExport: "SdkPopover", implTag: "el-popover", implExport: "ElPopover", implSubpath: "popover" },
  { sdkTag: "sdk-progress", sdkExport: "SdkProgress", implTag: "el-progress", implExport: "ElProgress", implSubpath: "progress" },
  { sdkTag: "sdk-radio", sdkExport: "SdkRadio", implTag: "el-radio", implExport: "ElRadio", implSubpath: "radio" },
  { sdkTag: "sdk-radio-button", sdkExport: "SdkRadioButton", implTag: "el-radio-button", implExport: "ElRadioButton", implSubpath: "radio" },
  { sdkTag: "sdk-radio-group", sdkExport: "SdkRadioGroup", implTag: "el-radio-group", implExport: "ElRadioGroup", implSubpath: "radio" },
  { sdkTag: "sdk-rate", sdkExport: "SdkRate", implTag: "el-rate", implExport: "ElRate", implSubpath: "rate" },
  { sdkTag: "sdk-result", sdkExport: "SdkResult", implTag: "el-result", implExport: "ElResult", implSubpath: "result" },
  { sdkTag: "sdk-row", sdkExport: "SdkRow", implTag: "el-row", implExport: "ElRow", implSubpath: "row" },
  { sdkTag: "sdk-scrollbar", sdkExport: "SdkScrollbar", implTag: "el-scrollbar", implExport: "ElScrollbar", implSubpath: "scrollbar" },
  { sdkTag: "sdk-segmented", sdkExport: "SdkSegmented", implTag: "el-segmented", implExport: "ElSegmented", implSubpath: "segmented" },
  { sdkTag: "sdk-select", sdkExport: "SdkSelect", implTag: "el-select", implExport: "ElSelect", implSubpath: "select" },
  { sdkTag: "sdk-select-v2", sdkExport: "SdkSelectV2", implTag: "el-select-v2", implExport: "ElSelectV2", implSubpath: "select-v2" },
  { sdkTag: "sdk-skeleton", sdkExport: "SdkSkeleton", implTag: "el-skeleton", implExport: "ElSkeleton", implSubpath: "skeleton" },
  { sdkTag: "sdk-skeleton-item", sdkExport: "SdkSkeletonItem", implTag: "el-skeleton-item", implExport: "ElSkeletonItem", implSubpath: "skeleton" },
  { sdkTag: "sdk-slider", sdkExport: "SdkSlider", implTag: "el-slider", implExport: "ElSlider", implSubpath: "slider" },
  { sdkTag: "sdk-space", sdkExport: "SdkSpace", implTag: "el-space", implExport: "ElSpace", implSubpath: "space" },
  { sdkTag: "sdk-splitter", sdkExport: "SdkSplitter", implTag: "el-splitter", implExport: "ElSplitter", implSubpath: "splitter" },
  { sdkTag: "sdk-splitter-panel", sdkExport: "SdkSplitterPanel", implTag: "el-splitter-panel", implExport: "ElSplitterPanel", implSubpath: "splitter" },
  { sdkTag: "sdk-statistic", sdkExport: "SdkStatistic", implTag: "el-statistic", implExport: "ElStatistic", implSubpath: "statistic" },
  { sdkTag: "sdk-step", sdkExport: "SdkStep", implTag: "el-step", implExport: "ElStep", implSubpath: "steps" },
  { sdkTag: "sdk-steps", sdkExport: "SdkSteps", implTag: "el-steps", implExport: "ElSteps", implSubpath: "steps" },
  { sdkTag: "sdk-sub-menu", sdkExport: "SdkSubMenu", implTag: "el-sub-menu", implExport: "ElSubMenu", implSubpath: "menu" },
  { sdkTag: "sdk-switch", sdkExport: "SdkSwitch", implTag: "el-switch", implExport: "ElSwitch", implSubpath: "switch" },
  { sdkTag: "sdk-tab-pane", sdkExport: "SdkTabPane", implTag: "el-tab-pane", implExport: "ElTabPane", implSubpath: "tabs" },
  { sdkTag: "sdk-table", sdkExport: "SdkTable", implTag: "el-table", implExport: "ElTable", implSubpath: "table" },
  { sdkTag: "sdk-table-column", sdkExport: "SdkTableColumn", implTag: "el-table-column", implExport: "ElTableColumn", implSubpath: "table" },
  { sdkTag: "sdk-table-v2", sdkExport: "SdkTableV2", implTag: "el-table-v2", implExport: "ElTableV2", implSubpath: "table-v2" },
  { sdkTag: "sdk-tabs", sdkExport: "SdkTabs", implTag: "el-tabs", implExport: "ElTabs", implSubpath: "tabs" },
  { sdkTag: "sdk-tag", sdkExport: "SdkTag", implTag: "el-tag", implExport: "ElTag", implSubpath: "tag" },
  { sdkTag: "sdk-text", sdkExport: "SdkText", implTag: "el-text", implExport: "ElText", implSubpath: "text" },
  { sdkTag: "sdk-time-picker", sdkExport: "SdkTimePicker", implTag: "el-time-picker", implExport: "ElTimePicker", implSubpath: "time-picker" },
  { sdkTag: "sdk-time-select", sdkExport: "SdkTimeSelect", implTag: "el-time-select", implExport: "ElTimeSelect", implSubpath: "time-select" },
  { sdkTag: "sdk-timeline", sdkExport: "SdkTimeline", implTag: "el-timeline", implExport: "ElTimeline", implSubpath: "timeline" },
  { sdkTag: "sdk-timeline-item", sdkExport: "SdkTimelineItem", implTag: "el-timeline-item", implExport: "ElTimelineItem", implSubpath: "timeline" },
  { sdkTag: "sdk-tooltip", sdkExport: "SdkTooltip", implTag: "el-tooltip", implExport: "ElTooltip", implSubpath: "tooltip" },
  { sdkTag: "sdk-tour", sdkExport: "SdkTour", implTag: "el-tour", implExport: "ElTour", implSubpath: "tour" },
  { sdkTag: "sdk-tour-step", sdkExport: "SdkTourStep", implTag: "el-tour-step", implExport: "ElTourStep", implSubpath: "tour" },
  { sdkTag: "sdk-transfer", sdkExport: "SdkTransfer", implTag: "el-transfer", implExport: "ElTransfer", implSubpath: "transfer" },
  { sdkTag: "sdk-tree", sdkExport: "SdkTree", implTag: "el-tree", implExport: "ElTree", implSubpath: "tree" },
  { sdkTag: "sdk-tree-select", sdkExport: "SdkTreeSelect", implTag: "el-tree-select", implExport: "ElTreeSelect", implSubpath: "tree-select" },
  { sdkTag: "sdk-tree-v2", sdkExport: "SdkTreeV2", implTag: "el-tree-v2", implExport: "ElTreeV2", implSubpath: "tree-v2" },
  { sdkTag: "sdk-upload", sdkExport: "SdkUpload", implTag: "el-upload", implExport: "ElUpload", implSubpath: "upload" },
  { sdkTag: "sdk-watermark", sdkExport: "SdkWatermark", implTag: "el-watermark", implExport: "ElWatermark", implSubpath: "watermark" },
];

/** Excluded UI primitives and imperative services that remain platform-owned. */
export const SDK_UI_FORBIDDEN_COMPONENTS: readonly SdkUiForbiddenComponent[] = [
  { implTag: "el-config-provider", implExport: "ElConfigProvider", replacement: "Platform host manages locale and theme configuration automatically" },
  { implTag: "el-page-header", implExport: "ElPageHeader", replacement: "Platform host manages page headers; declare panel commands under manifest.commands" },
  { implTag: "el-popper", implExport: "ElPopper", replacement: "Use <sdk-popover> or <sdk-tooltip> instead of internal floating primitives" },
  { implTag: "el-popconfirm", implExport: "ElPopconfirm", replacement: "Declare a write operation so the platform host confirms and dispatches it" },
  { implExport: "ElMessage", replacement: "usePanelContext().notify({ kind, text }) from @ontomato/sdk/panel" },
  { implExport: "ElMessageBox", replacement: "Declare a write operation so the platform host confirms it, or use <sdk-dialog> for local UI state" },
  { implExport: "ElNotification", replacement: "usePanelContext().notify({ kind, text }) from @ontomato/sdk/panel" },
  { implExport: "ElLoading", replacement: "v-sdk-loading in templates or vSdkLoading from @ontomato/sdk/ui" },
];

/** Supported directives exposed under `v-sdk-*` and `@ontomato/sdk/ui`. Registered via `app.directive(...)`. */
export const SDK_UI_DIRECTIVES: readonly SdkUiDirectiveMapping[] = [
  {
    sdkName: "v-sdk-loading",
    sdkExport: "vSdkLoading",
    implName: "v-loading",
    implExport: "vLoading",
    implSubpath: "loading",
    description: "Displays a loading overlay over the host element while bound to a truthy expression.",
  },
  {
    sdkName: "v-sdk-infinite-scroll",
    sdkExport: "vSdkInfiniteScroll",
    implName: "v-infinite-scroll",
    implExport: "ElInfiniteScroll",
    implSubpath: "infinite-scroll",
    description: "Invokes a callback when the scroll container nears the bottom of its content.",
  },
  {
    sdkName: "v-sdk-popover",
    sdkExport: "vSdkPopover",
    implName: "v-popover",
    implExport: "ElPopoverDirective",
    implSubpath: "popover",
    description: "Attaches a declared <sdk-popover> reference to the host trigger element.",
  },
];

const COLOR_FAMILIES = ["primary", "success", "warning", "danger", "info"] as const;
const COLOR_SHADES = ["light-3", "light-5", "light-7", "light-8", "light-9", "dark-2", "rgb"] as const;
const STATUS_TEXT_FAMILIES = ["success", "warning", "danger", "info"] as const;

const colorFamilyTokens: SdkThemeTokenMapping[] = COLOR_FAMILIES.flatMap((family) => [
  { sdk: `--sdk-color-${family}`, impl: `--el-color-${family}`, kind: "color", overridable: true } as const,
  ...COLOR_SHADES.map((shade) => ({
    sdk: `--sdk-color-${family}-${shade}`,
    impl: `--el-color-${family}-${shade}`,
    kind: "color",
    overridable: false,
  } as const)),
]);

const statusTextTokens: SdkThemeTokenMapping[] = STATUS_TEXT_FAMILIES.map((family) => ({
  sdk: `--sdk-color-${family}-text`,
  impl: `--el-color-${family}-text`,
  kind: "color",
  overridable: false,
} as const));

/** Author-facing `--sdk-*` CSS custom properties mapped from internal `--el-*` variables. */
export const SDK_THEME_TOKENS: readonly SdkThemeTokenMapping[] = [
  ...colorFamilyTokens,
  ...statusTextTokens,
  { sdk: "--sdk-bg-color", impl: "--el-bg-color", kind: "color", overridable: true },
  { sdk: "--sdk-bg-color-page", impl: "--el-bg-color-page", kind: "color", overridable: true },
  { sdk: "--sdk-bg-color-overlay", impl: "--el-bg-color-overlay", kind: "color", overridable: true },
  { sdk: "--sdk-overlay-color", impl: "--el-overlay-color", kind: "color", overridable: false },
  { sdk: "--sdk-overlay-color-light", impl: "--el-overlay-color-light", kind: "color", overridable: false },
  { sdk: "--sdk-overlay-color-lighter", impl: "--el-overlay-color-lighter", kind: "color", overridable: false },
  { sdk: "--sdk-fill-color", impl: "--el-fill-color", kind: "color", overridable: false },
  { sdk: "--sdk-fill-color-light", impl: "--el-fill-color-light", kind: "color", overridable: false },
  { sdk: "--sdk-fill-color-lighter", impl: "--el-fill-color-lighter", kind: "color", overridable: false },
  { sdk: "--sdk-fill-color-extra-light", impl: "--el-fill-color-extra-light", kind: "color", overridable: false },
  { sdk: "--sdk-fill-color-dark", impl: "--el-fill-color-dark", kind: "color", overridable: false },
  { sdk: "--sdk-fill-color-darker", impl: "--el-fill-color-darker", kind: "color", overridable: false },
  { sdk: "--sdk-fill-color-blank", impl: "--el-fill-color-blank", kind: "color", overridable: false },
  { sdk: "--sdk-border-color", impl: "--el-border-color", kind: "color", overridable: true },
  { sdk: "--sdk-border-color-light", impl: "--el-border-color-light", kind: "color", overridable: false },
  { sdk: "--sdk-border-color-lighter", impl: "--el-border-color-lighter", kind: "color", overridable: false },
  { sdk: "--sdk-border-color-extra-light", impl: "--el-border-color-extra-light", kind: "color", overridable: false },
  { sdk: "--sdk-border-color-dark", impl: "--el-border-color-dark", kind: "color", overridable: false },
  { sdk: "--sdk-border-color-darker", impl: "--el-border-color-darker", kind: "color", overridable: false },
  { sdk: "--sdk-text-color-primary", impl: "--el-text-color-primary", kind: "color", overridable: true },
  { sdk: "--sdk-text-color-regular", impl: "--el-text-color-regular", kind: "color", overridable: true },
  { sdk: "--sdk-text-color-secondary", impl: "--el-text-color-secondary", kind: "color", overridable: true },
  { sdk: "--sdk-text-color-placeholder", impl: "--el-text-color-placeholder", kind: "color", overridable: false },
  { sdk: "--sdk-text-color-disabled", impl: "--el-text-color-disabled", kind: "color", overridable: false },
];

/** Legacy `--el-*` aliases mapped to their canonical SDK or platform design tokens. */
export const SDK_THEME_TOKEN_ALIASES: readonly SdkThemeTokenAlias[] = [
  { impl: "--el-color-error", replacement: "--sdk-color-danger" },
  ...COLOR_SHADES.map((shade) => ({
    impl: `--el-color-error-${shade}`,
    replacement: `--sdk-color-danger-${shade}`,
  } as const)),
  { impl: "--el-text-color-tertiary", replacement: "--sdk-text-color-placeholder" },
  { impl: "--el-disabled-text-color", replacement: "--sdk-text-color-disabled" },
  { impl: "--el-font-family", replacement: "--font-sans" },
  { impl: "--el-font-family-mono", replacement: "--font-mono" },
  { impl: "--el-font-size-extra-small", replacement: "--text-xs" },
  { impl: "--el-font-size-small", replacement: "--text-sm" },
  { impl: "--el-font-size-base", replacement: "--text-base" },
  { impl: "--el-font-size-medium", replacement: "--text-lg" },
  { impl: "--el-font-size-large", replacement: "--text-xl" },
  { impl: "--el-border-radius-small", replacement: "--radius-xs" },
  { impl: "--el-border-radius-base", replacement: "--radius-sm" },
  { impl: "--el-component-size-small", replacement: "--control-height-sm" },
  { impl: "--el-component-size", replacement: "--control-height" },
  { impl: "--el-component-size-large", replacement: "--control-height-lg" },
  { impl: "--el-box-shadow", replacement: "--elevation-overlay" },
];

/** Non-`--sdk-*` platform design tokens published in the SDK theme token catalogue. */
export const SDK_PLATFORM_THEME_TOKENS: readonly SdkPlatformThemeToken[] = [
  { name: "--on-primary", kind: "color", overridable: true },
  { name: "--brand-link", kind: "color", overridable: true },
  { name: "--brand-primary-hover", kind: "color", overridable: false },
  { name: "--brand-primary-tint", kind: "color", overridable: false },
  { name: "--font-sans", kind: "font", overridable: false },
  { name: "--font-mono", kind: "font", overridable: false },
  { name: "--text-xs", kind: "length", overridable: true },
  { name: "--text-sm", kind: "length", overridable: true },
  { name: "--text-base", kind: "length", overridable: true },
  { name: "--text-lg", kind: "length", overridable: true },
  { name: "--text-xl", kind: "length", overridable: true },
  { name: "--leading-xs", kind: "length", overridable: true },
  { name: "--leading-sm", kind: "length", overridable: true },
  { name: "--leading-base", kind: "length", overridable: true },
  { name: "--leading-lg", kind: "length", overridable: true },
  { name: "--leading-xl", kind: "length", overridable: true },
  { name: "--radius-xs", kind: "length", overridable: true },
  { name: "--radius-sm", kind: "length", overridable: true },
  { name: "--radius-md", kind: "length", overridable: true },
  { name: "--radius-lg", kind: "length", overridable: true },
  { name: "--radius-full", kind: "length", overridable: true },
  { name: "--spacing-xs", kind: "length", overridable: false },
  { name: "--spacing-sm", kind: "length", overridable: true },
  { name: "--spacing-md", kind: "length", overridable: true },
  { name: "--spacing-lg", kind: "length", overridable: true },
  { name: "--spacing-xl", kind: "length", overridable: false },
  { name: "--control-height-sm", kind: "length", overridable: true },
  { name: "--control-height", kind: "length", overridable: true },
  { name: "--control-height-lg", kind: "length", overridable: true },
  { name: "--list-row-two-line-height", kind: "length", overridable: false },
  { name: "--pane-list-width", kind: "length", overridable: false },
  { name: "--pane-narrow-breakpoint", kind: "length", overridable: false },
  { name: "--workbench-aside-width", kind: "length", overridable: false },
  { name: "--workbench-detail-width", kind: "length", overridable: false },
  { name: "--workbench-narrow-breakpoint", kind: "length", overridable: false },
  { name: "--detail-header-padding", kind: "length", overridable: false },
  { name: "--detail-footer-padding", kind: "length", overridable: false },
  { name: "--elevation-flat", kind: "elevation", overridable: true },
  { name: "--elevation-panel", kind: "elevation", overridable: true },
  { name: "--elevation-overlay", kind: "elevation", overridable: true },
  { name: "--elevation-modal", kind: "elevation", overridable: true },
];

/** SDK exports renamed to hide underlying implementation libraries. */
export const SDK_RENAMED_EXPORTS: readonly SdkRenamedExportMapping[] = [
  {
    implExport: "G6GraphCanvas",
    implTag: "g6-graph-canvas",
    sdkExport: "InteractiveGraphCanvas",
    sdkTag: "interactive-graph-canvas",
    module: "@ontomato/sdk/graph",
  },
];

const componentsBySdkTag = new Map(SDK_UI_COMPONENTS.map((entry) => [entry.sdkTag, entry]));
const componentsByImplTag = new Map(SDK_UI_COMPONENTS.map((entry) => [entry.implTag, entry]));
const componentsByImplExport = new Map(SDK_UI_COMPONENTS.map((entry) => [entry.implExport, entry]));
const forbiddenByImplTag = new Map(
  SDK_UI_FORBIDDEN_COMPONENTS.flatMap((entry) => (entry.implTag ? [[entry.implTag, entry] as const] : [])),
);
const forbiddenByImplExport = new Map(SDK_UI_FORBIDDEN_COMPONENTS.map((entry) => [entry.implExport, entry]));
const directivesBySdkName = new Map(SDK_UI_DIRECTIVES.map((entry) => [entry.sdkName, entry]));
const directivesByImplName = new Map(SDK_UI_DIRECTIVES.map((entry) => [entry.implName, entry]));
const themeByImpl = new Map<string, string>([
  ...SDK_THEME_TOKENS.map((entry) => [entry.impl, entry.sdk] as const),
  ...SDK_THEME_TOKEN_ALIASES.map((entry) => [entry.impl, entry.replacement] as const),
]);
const renamedByImplExport = new Map(SDK_RENAMED_EXPORTS.map((entry) => [entry.implExport, entry]));
const renamedByImplTag = new Map(SDK_RENAMED_EXPORTS.map((entry) => [entry.implTag, entry]));

export function sdkUiComponentByTag(tag: string): SdkUiComponentMapping | undefined {
  return componentsBySdkTag.get(tag.toLowerCase() as `sdk-${string}`);
}

export function sdkUiComponentByImplTag(tag: string): SdkUiComponentMapping | undefined {
  return componentsByImplTag.get(tag.toLowerCase() as `el-${string}`);
}

export function sdkUiComponentByImplExport(name: string): SdkUiComponentMapping | undefined {
  return componentsByImplExport.get(name as `El${string}`);
}

export function sdkUiForbiddenByImplTag(tag: string): SdkUiForbiddenComponent | undefined {
  return forbiddenByImplTag.get(tag.toLowerCase() as `el-${string}`);
}

export function sdkUiForbiddenByImplExport(name: string): SdkUiForbiddenComponent | undefined {
  return forbiddenByImplExport.get(name as `El${string}`);
}

export function sdkUiDirectiveByName(name: string): SdkUiDirectiveMapping | undefined {
  return directivesBySdkName.get(name.toLowerCase() as `v-sdk-${string}`);
}

export function sdkUiDirectiveByImplName(name: string): SdkUiDirectiveMapping | undefined {
  return directivesByImplName.get(name.toLowerCase() as `v-${string}`);
}

export function sdkThemeTokenReplacement(elToken: string): string | null {
  return themeByImpl.get(elToken) ?? null;
}

export function sdkRenamedExportByImpl(nameOrTag: string): SdkRenamedExportMapping | undefined {
  return renamedByImplExport.get(nameOrTag) ?? renamedByImplTag.get(nameOrTag.toLowerCase());
}

/** Complete theme token catalogue entries (SDK `--sdk-*` tokens + platform tokens). */
export function sdkThemeTokenCatalogueEntries(): readonly SdkPlatformThemeToken[] {
  return [
    ...SDK_THEME_TOKENS.map(({ sdk, kind, overridable }) => ({ name: sdk, kind, overridable })),
    ...SDK_PLATFORM_THEME_TOKENS,
  ];
}

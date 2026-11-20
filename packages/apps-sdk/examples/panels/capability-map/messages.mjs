/*
 * The capability map panel's own words, by locale and key (`content.messages`). Ontology layer, type, relation kind and
 * graph status texts come from the platform's own locale tables; these keys cover only the panel's shell controls and
 * section chrome.
 */
export default {
  en: {
    "capMap.modeLabel": "Graph mode",
    "capMap.modeType": "Type mode",
    "capMap.modeInstance": "Instance mode",
    "capMap.searchPlaceholderType": "Highlight types on canvas",
    "capMap.searchPlaceholderInstance": "Highlight drawn nodes",
    "capMap.clearSearch": "Clear",
    "capMap.switchUser": "Switch user",
    "capMap.hideUserPicker": "Close",
    "capMap.useSelectedAsStart": "Set selected as start",
    "capMap.resetStart": "Current user",
    "capMap.resetToCurrentUser": "Reset start to current user",
    "capMap.relationsTitle": "Node relations",
    "capMap.relationsHint": "One-hop relations of the selected node. Click any peer to move selection.",
    "capMap.relationsEmpty": "Select a node on the graph to inspect its one-hop relations.",
    "capMap.typePickerTitle": "Pick a starting object",
    "capMap.typePickerHint": "Click a type on the graph, then choose an object to open instance mode from it.",
    "capMap.userPickerTitle": "Choose a starting user",
    "capMap.userPickerHint": "Pick any readable user to explore one-hop relations from that user.",
  },
  "zh-CN": {
    "capMap.modeLabel": "图谱模式",
    "capMap.modeType": "类型模式",
    "capMap.modeInstance": "实例模式",
    "capMap.searchPlaceholderType": "高亮画布上的类型",
    "capMap.searchPlaceholderInstance": "高亮已画出的节点",
    "capMap.clearSearch": "清空",
    "capMap.switchUser": "切换用户",
    "capMap.hideUserPicker": "关闭",
    "capMap.useSelectedAsStart": "以选中节点为起点",
    "capMap.resetStart": "当前用户",
    "capMap.resetToCurrentUser": "重置起点为当前用户",
    "capMap.relationsTitle": "节点关系",
    "capMap.relationsHint": "选中节点的一跳关系，点击关联节点可切换选中。",
    "capMap.relationsEmpty": "在画布上选中一个节点以查看其一跳关系。",
    "capMap.typePickerTitle": "选择起点对象",
    "capMap.typePickerHint": "点击画布上的类型节点，再从中选择一个对象进入实例模式。",
    "capMap.userPickerTitle": "选择起点用户",
    "capMap.userPickerHint": "选择任意可读用户，从该用户出发探索一跳关系。",
  },
};

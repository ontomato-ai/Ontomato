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
    "capMap.relationsTitle": "Node relations",
    "capMap.relationsHint": "One-hop relations of the selected node. Click any peer to move selection.",
    "capMap.relationsEmpty": "Select a node on the graph to inspect its one-hop relations.",
    "capMap.typePickerTitle": "Pick a starting object",
    "capMap.typePickerHint": "Click a type on the graph, then choose an object to open instance mode from it.",
    "capMap.typePickerEmpty": "Select a type node on the graph to list readable objects of that type.",
    "capMap.userPickerTitle": "Choose a starting user",
    "capMap.userPickerHint": "Pick any readable user to explore one-hop relations from that user.",
  },
};

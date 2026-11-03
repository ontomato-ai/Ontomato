import { API_BASE } from "../utils/api-base";

/** The Manager shares the deployment root with the workbench in every environment. */
export const ONTOLOGY_MANAGER_PATH = `${API_BASE.replace(/\/api$/, "")}/ontology-manager/`;

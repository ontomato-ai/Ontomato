import { apiPost } from "../../utils/api";

export const queryViewApi = {
  getMetas: () => apiPost("/admin/getMetas", {}),
  getWholeClassDataByPage: (payload: unknown) => apiPost("/data/getWholeClassDataByPage", payload),
  queryDistinctAttrValue: (payload: unknown) => apiPost("/data/queryDistinctAttrValue", payload),
};

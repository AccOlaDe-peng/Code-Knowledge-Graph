/**
 * 数据血缘 API 客户端。
 */
import httpClient from "./graphApi";
import type { DataLineageJSON } from "../pages/DataLineage/types/dataLineage";

/**
 * 获取数据血缘数据。
 */
export async function getDataLineage(): Promise<DataLineageJSON> {
  return httpClient.get("/data-lineage");
}

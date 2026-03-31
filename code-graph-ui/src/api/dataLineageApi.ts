/**
 * 数据血缘 API 客户端。
 */
import httpClient from "./graphApi";
import type { DataLineageJSON } from "../pages/DataLineage/types/dataLineage";

/**
 * 获取数据血缘数据。
 * @param name 数据库名称，如 'adms'，对应文件 {name}-lineage.json
 */
export async function getDataLineage(name: string): Promise<DataLineageJSON> {
  return httpClient.get(`/data-lineage?name=${encodeURIComponent(name)}`);
}

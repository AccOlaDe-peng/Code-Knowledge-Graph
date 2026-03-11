import axios from 'axios';
import type {
  GraphListResponse,
  GraphDetailResponse,
  CallGraphResponse,
  LineageGraphResponse,
  ServicesGraphResponse,
} from '../types/api';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
api.interceptors.request.use(
  (config) => config,
  (error) => Promise.reject(error)
);

// 响应拦截器
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const message = error.response?.data?.detail || error.message || '请求失败';
    return Promise.reject(new Error(message));
  }
);

export const graphApi = {
  // 获取图谱列表
  listGraphs(): Promise<GraphListResponse> {
    return api.get('/graph');
  },

  // 获取图谱详情
  getGraph(graphId: string): Promise<GraphDetailResponse> {
    return api.get('/graph', { params: { graph_id: graphId } });
  },

  // 获取调用图
  getCallGraph(graphId: string): Promise<CallGraphResponse> {
    return api.get('/callgraph', { params: { graph_id: graphId } });
  },

  // 获取数据血缘图
  getLineageGraph(graphId: string): Promise<LineageGraphResponse> {
    return api.get('/lineage', { params: { graph_id: graphId } });
  },

  // 获取服务图
  getServicesGraph(graphId: string): Promise<ServicesGraphResponse> {
    return api.get('/services', { params: { graph_id: graphId } });
  },
};

export default api;

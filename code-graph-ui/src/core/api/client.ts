import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios'

// ─── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
const TIMEOUT = 30_000

// ─── HTTP Client ──────────────────────────────────────────────────────────────

class ApiClient {
  private client: AxiosInstance

  constructor(baseURL: string, timeout: number) {
    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    this.setupInterceptors()
  }

  private setupInterceptors() {
    // Request interceptor
    this.client.interceptors.request.use(
      config => {
        // Add auth token if available
        const token = localStorage.getItem('auth_token')
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
        return config
      },
      error => Promise.reject(error)
    )

    // Response interceptor
    this.client.interceptors.response.use(
      response => response.data,
      error => {
        const message =
          error.response?.data?.detail ??
          error.response?.data?.message ??
          error.message ??
          'Request failed'

        // Handle specific error codes
        if (error.response?.status === 401) {
          // Unauthorized - clear token and redirect to login
          localStorage.removeItem('auth_token')
          window.location.href = '/login'
        }

        return Promise.reject(new Error(message))
      }
    )
  }

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.client.get(url, config)
  }

  async post<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    return this.client.post(url, data, config)
  }

  async put<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    return this.client.put(url, data, config)
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.client.delete(url, config)
  }

  async patch<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    return this.client.patch(url, data, config)
  }
}

// ─── Export singleton instance ────────────────────────────────────────────────

export const apiClient = new ApiClient(BASE_URL, TIMEOUT)

export default apiClient

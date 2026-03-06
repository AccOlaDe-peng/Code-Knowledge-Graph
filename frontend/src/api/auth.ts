import api from './index'

export interface RegisterDto {
  email: string
  password: string
}

export interface LoginDto {
  email: string
  password: string
}

export interface AuthResponse {
  access_token: string
  user: {
    id: string
    email: string
  }
}

export const authApi = {
  register: (data: RegisterDto) => {
    return api.post<AuthResponse>('/auth/register', data)
  },

  login: (data: LoginDto) => {
    return api.post<AuthResponse>('/auth/login', data)
  }
}

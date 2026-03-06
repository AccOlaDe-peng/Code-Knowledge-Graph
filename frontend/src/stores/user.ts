import { defineStore } from 'pinia'
import { ref } from 'vue'

interface User {
  id: string
  email: string
}

export const useUserStore = defineStore('user', () => {
  const user = ref<User | null>(null)
  const token = ref<string | null>(localStorage.getItem('token'))

  const setUser = (userData: User) => {
    user.value = userData
  }

  const setToken = (tokenValue: string) => {
    token.value = tokenValue
    localStorage.setItem('token', tokenValue)
  }

  const logout = () => {
    user.value = null
    token.value = null
    localStorage.removeItem('token')
  }

  const isAuthenticated = () => {
    return !!token.value
  }

  return {
    user,
    token,
    setUser,
    setToken,
    logout,
    isAuthenticated
  }
})

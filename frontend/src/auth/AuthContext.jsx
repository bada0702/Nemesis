import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { login as apiLogin } from '../api/client'
import { getUser, setAuth, clearAuth } from '../api/token'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

const ROLE_LABEL = { admin: 'Administrator', operator: 'Operator', viewer: 'Viewer' }
export const roleLabel = (role) => ROLE_LABEL[role] ?? role

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getUser())

  const login = useCallback(async (username, password) => {
    const r = await apiLogin(username, password)
    const u = { username: r.data.username, role: r.data.role }
    setAuth(r.data.token, u)
    setUser(u)
    return u
  }, [])

  const logout = useCallback(() => { clearAuth(); setUser(null) }, [])

  // 401 인터셉터가 발행하는 전역 로그아웃 이벤트 처리(세션 만료)
  useEffect(() => {
    const onLogout = () => { clearAuth(); setUser(null) }
    window.addEventListener('auth:logout', onLogout)
    return () => window.removeEventListener('auth:logout', onLogout)
  }, [])

  const isOperator = user?.role === 'admin' || user?.role === 'operator'
  const isAdmin    = user?.role === 'admin'

  return (
    <AuthContext.Provider value={{ user, login, logout, isOperator, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

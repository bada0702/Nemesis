import React, { useState } from 'react'
import { Shield, LogIn, Loader2 } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [busy, setBusy]         = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(username.trim(), password)
    } catch (err) {
      setError(err.response?.data?.error ?? '로그인에 실패했습니다. 네트워크를 확인하세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0e14] px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm card-bg rounded-2xl p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-xl bg-blue-600/15 flex items-center justify-center">
            <Shield className="w-6 h-6 text-blue-400" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-wide">NEMESIS</h1>
          <p className="text-xs text-gray-500">HA 장애대응 관제 콘솔</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400">아이디</label>
            <input
              autoFocus value={username} onChange={e => setUsername(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white outline-none focus:border-blue-500"
              placeholder="admin" autoComplete="username" />
          </div>
          <div>
            <label className="text-xs text-gray-400">비밀번호</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white outline-none focus:border-blue-500"
              placeholder="••••••••" autoComplete="current-password" />
          </div>
        </div>

        {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}

        <button
          type="submit" disabled={busy || !username || !password}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          {busy ? '로그인 중...' : '로그인'}
        </button>
      </form>
    </div>
  )
}

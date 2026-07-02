import React, { useEffect, useState } from 'react'
import { Users, UserPlus, Trash2, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react'
import { listUsers, createUser, deleteUser, changeUserPassword } from '../../api/client'
import { useAuth, roleLabel } from '../../auth/AuthContext'

const inputCls = "w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500"
const ROLES = ['admin', 'operator', 'viewer']

const errMsg = (e, fallback) => e?.response?.data?.error || fallback

/** 관리자 전용 사용자 계정 관리(추가·삭제·비밀번호 변경). admin이 아니면 렌더링하지 않는다. */
export default function UserManagement() {
  const { user, isAdmin } = useAuth()
  const [users, setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const [notice, setNotice] = useState(null)

  // 신규 계정 입력
  const [form, setForm] = useState({ username: '', password: '', role: 'viewer' })
  const [creating, setCreating] = useState(false)

  // 비밀번호 변경 중인 사용자 id → 입력값
  const [pwEdit, setPwEdit] = useState({ id: null, value: '' })

  async function load() {
    setLoading(true); setError(null)
    try { const r = await listUsers(); setUsers(r.data ?? []) }
    catch (e) { setError(errMsg(e, '사용자 목록을 불러오지 못했습니다.')) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (isAdmin) load() }, [isAdmin])

  if (!isAdmin) return null

  function flash(msg) { setNotice(msg); setTimeout(() => setNotice(null), 2500) }

  async function onCreate(e) {
    e.preventDefault()
    setCreating(true); setError(null)
    try {
      await createUser(form)
      setForm({ username: '', password: '', role: 'viewer' })
      flash(`사용자 '${form.username}' 생성됨`)
      await load()
    } catch (e) { setError(errMsg(e, '사용자 생성 실패')) }
    finally { setCreating(false) }
  }

  async function onDelete(u) {
    if (!window.confirm(`사용자 '${u.username}' 을(를) 삭제하시겠습니까?`)) return
    setError(null)
    try { await deleteUser(u.id); flash(`사용자 '${u.username}' 삭제됨`); await load() }
    catch (e) { setError(errMsg(e, '삭제 실패')) }
  }

  async function onChangePassword(u) {
    if (!pwEdit.value || pwEdit.value.length < 4) { setError('비밀번호는 4자 이상이어야 합니다.'); return }
    setError(null)
    try {
      await changeUserPassword(u.id, pwEdit.value)
      setPwEdit({ id: null, value: '' })
      flash(`'${u.username}' 비밀번호 변경됨`)
    } catch (e) { setError(errMsg(e, '비밀번호 변경 실패')) }
  }

  const roleBadge = (role) => {
    const cls = role === 'admin' ? 'bg-blue-500/15 text-blue-300'
      : role === 'operator' ? 'bg-emerald-500/15 text-emerald-300'
      : 'bg-gray-600/20 text-gray-400'
    return <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${cls}`}>{roleLabel(role)}</span>
  }

  return (
    <div className="card-bg rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-400" /> 사용자 계정 관리
          <span className="text-[10px] font-normal text-gray-500">관리자 전용</span>
        </h3>
        <button onClick={load} className="text-gray-400 hover:text-white p-1.5 rounded-lg border border-gray-700" title="새로고침">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error  && <div className="mb-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
      {notice && <div className="mb-3 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">✓ {notice}</div>}

      {/* 신규 계정 추가 */}
      <form onSubmit={onCreate} className="grid grid-cols-12 gap-2 items-end mb-5">
        <div className="col-span-4">
          <label className="block text-[10px] text-gray-500 mb-1">아이디</label>
          <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
            className={inputCls} placeholder="username" autoComplete="off" required />
        </div>
        <div className="col-span-4">
          <label className="block text-[10px] text-gray-500 mb-1">비밀번호 (4자 이상)</label>
          <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            className={inputCls} placeholder="••••••••" autoComplete="new-password" required />
        </div>
        <div className="col-span-2">
          <label className="block text-[10px] text-gray-500 mb-1">역할</label>
          <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className={inputCls}>
            {ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <button type="submit" disabled={creating}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50">
            <UserPlus className="w-3.5 h-3.5" /> {creating ? '생성 중' : '추가'}
          </button>
        </div>
      </form>

      {/* 사용자 목록 */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left font-medium py-2 px-2">아이디</th>
              <th className="text-left font-medium py-2 px-2">역할</th>
              <th className="text-left font-medium py-2 px-2">상태</th>
              <th className="text-right font-medium py-2 px-2">관리</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && !loading && (
              <tr><td colSpan={4} className="text-center text-gray-600 py-6">사용자가 없습니다.</td></tr>
            )}
            {users.map(u => (
              <tr key={u.id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                <td className="py-2.5 px-2 text-white font-medium">
                  {u.username}
                  {u.username === user?.username && <span className="ml-1.5 text-[10px] text-blue-400">(나)</span>}
                </td>
                <td className="py-2.5 px-2">{roleBadge(u.role)}</td>
                <td className="py-2.5 px-2">
                  <span className={u.enabled ? 'text-emerald-400' : 'text-gray-500'}>
                    {u.enabled ? '활성' : '비활성'}
                  </span>
                </td>
                <td className="py-2.5 px-2">
                  {pwEdit.id === u.id ? (
                    <div className="flex items-center justify-end gap-1.5">
                      <input type="password" value={pwEdit.value} autoFocus
                        onChange={e => setPwEdit(s => ({ ...s, value: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && onChangePassword(u)}
                        className="px-2 py-1 rounded text-xs bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500 w-36"
                        placeholder="새 비밀번호" />
                      <button onClick={() => onChangePassword(u)} className="text-emerald-400 hover:text-emerald-300 px-2 py-1 text-xs">저장</button>
                      <button onClick={() => setPwEdit({ id: null, value: '' })} className="text-gray-500 hover:text-gray-300 px-1 py-1 text-xs">취소</button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setPwEdit({ id: u.id, value: '' })}
                        className="flex items-center gap-1 text-gray-400 hover:text-blue-300 px-2 py-1 rounded" title="비밀번호 변경">
                        <KeyRound className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => onDelete(u)}
                        disabled={u.username === user?.username}
                        className="flex items-center gap-1 text-gray-400 hover:text-red-300 px-2 py-1 rounded disabled:opacity-30 disabled:hover:text-gray-400"
                        title={u.username === user?.username ? '본인 계정은 삭제할 수 없습니다' : '삭제'}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-gray-600 mt-3 flex items-center gap-1.5">
        <ShieldCheck className="w-3 h-3" /> 마지막 관리자 계정과 본인 계정은 삭제할 수 없습니다.
      </p>
    </div>
  )
}

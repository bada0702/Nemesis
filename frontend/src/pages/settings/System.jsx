import React, { useEffect, useState } from 'react'
import { Settings, Save, RefreshCw } from 'lucide-react'
import { getSystemSettings, updateSystemSettings } from '../../api/client'

function Field({ label, children, hint }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-300 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-gray-600 mt-1">{hint}</p>}
    </div>
  )
}

export default function SystemSettings() {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)

  async function load() {
    setLoading(true)
    try { const r = await getSystemSettings(); setSettings(r.data) }
    catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    try { await updateSystemSettings(settings); setSaved(true); setTimeout(() => setSaved(false), 2000) }
    finally { setSaving(false) }
  }

  const set = (key, value) => setSettings(s => ({ ...s, [key]: value }))
  const inputCls = "w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500"

  if (loading) return <div className="p-8 pt-0 text-center text-gray-500 py-16">로딩 중...</div>
  if (!settings) return null

  return (
    <div className="p-8 pt-0 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">시스템 설정</h2>
          <p className="text-xs text-gray-500 mt-1">NEMESIS 운영 파라미터 설정</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg border border-gray-700">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <form onSubmit={save} className="space-y-5">
        {/* 모니터링 */}
        <div className="card-bg rounded-xl p-5">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Settings className="w-4 h-4 text-blue-400" /> 모니터링 설정
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="폴링 간격 (초)" hint="에이전트 상태 수집 주기">
              <input type="number" value={settings.pollingIntervalSec} onChange={e => set('pollingIntervalSec', +e.target.value)} className={inputCls} min={5} max={60} />
            </Field>
            <Field label="메트릭 보관 기간 (일)" hint="수집된 성능 데이터 보관 기간">
              <input type="number" value={settings.metricsRetentionDays} onChange={e => set('metricsRetentionDays', +e.target.value)} className={inputCls} min={7} />
            </Field>
            <Field label="알람 보관 기간 (일)" hint="발생된 알람 이력 보관 기간">
              <input type="number" value={settings.alertRetentionDays} onChange={e => set('alertRetentionDays', +e.target.value)} className={inputCls} min={7} />
            </Field>
          </div>
        </div>

        {/* HA 설정 */}
        <div className="card-bg rounded-xl p-5">
          <h3 className="text-sm font-bold text-white mb-4">HA / Failover 설정</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="최대 Failover 횟수" hint="일정 시간 내 자동 Failover 최대 허용 횟수">
              <input type="number" value={settings.maxFailoverCount} onChange={e => set('maxFailoverCount', +e.target.value)} className={inputCls} min={1} max={10} />
            </Field>
            <Field label="Pingpong 방지 시간 (초)" hint="Failover 후 재Failover 대기 시간">
              <input type="number" value={settings.pingpongGuardSec} onChange={e => set('pingpongGuardSec', +e.target.value)} className={inputCls} min={5} />
            </Field>
          </div>
        </div>

        {/* AI */}
        <div className="card-bg rounded-xl p-5">
          <h3 className="text-sm font-bold text-white mb-4">AI 분석</h3>
          <Field label="AI 분석 활성화">
            <label className="flex items-center gap-3 cursor-pointer mt-2">
              <div onClick={() => set('aiEnabled', !settings.aiEnabled)}
                className={`w-10 h-5 rounded-full transition-colors relative ${settings.aiEnabled ? 'bg-blue-600' : 'bg-gray-700'}`}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${settings.aiEnabled ? 'left-5' : 'left-0.5'}`} />
              </div>
              <span className="text-xs text-gray-400">{settings.aiEnabled ? '활성화됨' : '비활성화됨'}</span>
            </label>
          </Field>
        </div>

        {/* AI (LLM) */}
        <div className="card-bg rounded-xl p-5">
          <h3 className="text-sm font-bold text-white mb-4">AI (LLM) 설정</h3>
          <Field label="제공자" hint="장애 판단·챗에 사용할 LLM 제공자">
            <select value={settings.llmProvider ?? 'ollama'} onChange={e => set('llmProvider', e.target.value)} className={inputCls}>
              <option value="ollama">Ollama (로컬)</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI</option>
            </select>
          </Field>
          {(settings.llmProvider ?? 'ollama') === 'ollama' && (
            <div className="grid grid-cols-2 gap-4 mt-1">
              <Field label="Ollama Base URL">
                <input value={settings.llmOllamaBaseUrl ?? ''} onChange={e => set('llmOllamaBaseUrl', e.target.value)} className={inputCls} placeholder="http://localhost:11434" />
              </Field>
              <Field label="Ollama 모델">
                <input value={settings.llmOllamaModel ?? ''} onChange={e => set('llmOllamaModel', e.target.value)} className={inputCls} placeholder="gemma2:9b" />
              </Field>
            </div>
          )}
          {settings.llmProvider === 'anthropic' && (
            <div className="grid grid-cols-2 gap-4 mt-1">
              <Field label="Claude 모델">
                <input value={settings.llmAnthropicModel ?? ''} onChange={e => set('llmAnthropicModel', e.target.value)} className={inputCls} placeholder="claude-haiku-4-5" />
              </Field>
              <Field label="Anthropic API 키" hint={settings.llmAnthropicApiKeySet ? '설정됨 — 변경하려면 새 키 입력' : '미설정'}>
                <input type="password" value={settings.llmAnthropicApiKey ?? ''} onChange={e => set('llmAnthropicApiKey', e.target.value)} className={inputCls}
                  placeholder={settings.llmAnthropicApiKeySet ? '••••••••(설정됨, 유지하려면 비워두세요)' : 'sk-ant-...'} />
              </Field>
            </div>
          )}
          {settings.llmProvider === 'openai' && (
            <div className="grid grid-cols-2 gap-4 mt-1">
              <Field label="OpenAI 모델">
                <input value={settings.llmOpenaiModel ?? ''} onChange={e => set('llmOpenaiModel', e.target.value)} className={inputCls} placeholder="gpt-4o-mini" />
              </Field>
              <Field label="OpenAI API 키" hint={settings.llmOpenaiApiKeySet ? '설정됨 — 변경하려면 새 키 입력' : '미설정'}>
                <input type="password" value={settings.llmOpenaiApiKey ?? ''} onChange={e => set('llmOpenaiApiKey', e.target.value)} className={inputCls}
                  placeholder={settings.llmOpenaiApiKeySet ? '••••••••(설정됨, 유지하려면 비워두세요)' : 'sk-...'} />
              </Field>
            </div>
          )}
        </div>

        {/* 알림 */}
        <div className="card-bg rounded-xl p-5">
          <h3 className="text-sm font-bold text-white mb-4">알림 채널</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="이메일 알림 수신자" hint="콤마로 여러 주소 입력 가능">
              <input value={settings.notificationEmail} onChange={e => set('notificationEmail', e.target.value)} className={inputCls} placeholder="ops@example.com" />
            </Field>
            <Field label="Slack Webhook URL" hint="비워두면 Slack 알림 비활성화">
              <input value={settings.notificationSlack} onChange={e => set('notificationSlack', e.target.value)} className={inputCls} placeholder="https://hooks.slack.com/..." />
            </Field>
          </div>
        </div>

        {/* 로케일 */}
        <div className="card-bg rounded-xl p-5">
          <h3 className="text-sm font-bold text-white mb-4">지역화</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="시간대">
              <select value={settings.timezone} onChange={e => set('timezone', e.target.value)} className={inputCls}>
                <option value="Asia/Seoul">Asia/Seoul (KST)</option>
                <option value="UTC">UTC</option>
              </select>
            </Field>
            <Field label="언어">
              <select value={settings.language} onChange={e => set('language', e.target.value)} className={inputCls}>
                <option value="ko">한국어</option>
                <option value="en">English</option>
              </select>
            </Field>
          </div>
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
            <Save className="w-4 h-4" />
            {saving ? '저장 중...' : saved ? '✓ 저장됨' : '설정 저장'}
          </button>
        </div>
      </form>
    </div>
  )
}

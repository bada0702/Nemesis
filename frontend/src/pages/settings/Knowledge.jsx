import React, { useEffect, useState, useCallback } from 'react'
import { BookOpen, Save, RefreshCw, Trash2, FilePlus, CheckCircle, AlertTriangle } from 'lucide-react'
import {
  getKnowledgeFiles, getKnowledgeFile, validateKnowledge,
  saveKnowledgeFile, deleteKnowledgeFile,
} from '../../api/client'

// 장애 지식베이스 파일 편집 페이지.
// 파일은 사이드카(nemesis-bot) 호스트에 있고, 백엔드 프록시(/api/ai/knowledge/**)를 통해
// 목록/읽기/검증/저장/삭제한다. 편집·삭제는 운영자 권한(백엔드 RbacFilter).
export default function KnowledgeSettings() {
  const [files, setFiles]       = useState([])
  const [meta, setMeta]         = useState({ knowledgeDir: '', injectedDomains: [] })
  const [sel, setSel]           = useState(null)      // 선택된 path
  const [content, setContent]   = useState('')
  const [dirty, setDirty]       = useState(false)
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState(false)
  const [msg, setMsg]           = useState(null)      // {type:'ok'|'err', text}
  const [valid, setValid]       = useState({ valid: true, error: null })

  const inputCls = "w-full px-3 py-2 rounded-lg text-xs bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500"

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const r = await getKnowledgeFiles()
      setFiles(r.data.files || [])
      setMeta({ knowledgeDir: r.data.knowledgeDir, injectedDomains: r.data.injectedDomains || [] })
    } catch (e) {
      setMsg({ type: 'err', text: '목록을 불러오지 못했습니다: ' + errText(e) })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadList() }, [loadList])

  async function open(path) {
    if (dirty && !confirm('저장하지 않은 변경이 있습니다. 무시하고 이동할까요?')) return
    setBusy(true); setMsg(null)
    try {
      const r = await getKnowledgeFile(path)
      setSel(path); setContent(r.data.content || ''); setDirty(false)
      setValid({ valid: true, error: null })
    } catch (e) {
      setMsg({ type: 'err', text: '파일을 열지 못했습니다: ' + errText(e) })
    } finally { setBusy(false) }
  }

  function newFile() {
    if (dirty && !confirm('저장하지 않은 변경이 있습니다. 무시하고 새 파일을 만들까요?')) return
    setSel('')  // 새 파일: 경로 직접 입력
    setContent(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"\n' +
      '         xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"\n' +
      '         xmlns:owl="http://www.w3.org/2002/07/owl#"\n' +
      '         xmlns:xsd="http://www.w3.org/2001/XMLSchema#"\n' +
      '         xmlns:kb="http://nemesis.local/kb#"\n' +
      '         xml:base="http://nemesis.local/kb#">\n' +
      '\n' +
      '  <owl:NamedIndividual rdf:about="#Fault_New">\n' +
      '    <rdf:type rdf:resource="#Fault"/>\n' +
      '    <rdfs:label>제목</rdfs:label>\n' +
      '    <kb:has_fault_type></kb:has_fault_type>\n' +
      '    <kb:has_os>linux</kb:has_os>\n' +
      '    <kb:has_target_sw></kb:has_target_sw>\n' +
      '    <kb:has_severity>warning</kb:has_severity>\n' +
      '    <kb:related_to rdf:resource="http://nemesis.local/kb#Fault_ProcessDown"/>\n' +
      '    <kb:has_symptom rdf:resource="#Symptom_New_1"/>\n' +
      '    <kb:has_cause rdf:resource="#Cause_New_1"/>\n' +
      '    <kb:diagnosed_by rdf:resource="#Diagnosis_New_1"/>\n' +
      '    <kb:resolved_by rdf:resource="#Action_New_1"/>\n' +
      '    <kb:has_caveat rdf:resource="#Caveat_New_1"/>\n' +
      '  </owl:NamedIndividual>\n' +
      '\n' +
      '  <owl:NamedIndividual rdf:about="#Symptom_New_1">\n' +
      '    <rdf:type rdf:resource="#Symptom"/>\n' +
      '    <kb:order rdf:datatype="xsd:integer">1</kb:order>\n' +
      '    <rdfs:label>증상</rdfs:label>\n' +
      '  </owl:NamedIndividual>\n' +
      '\n' +
      '  <owl:NamedIndividual rdf:about="#Cause_New_1">\n' +
      '    <rdf:type rdf:resource="#Cause"/>\n' +
      '    <kb:order rdf:datatype="xsd:integer">1</kb:order>\n' +
      '    <rdfs:label>원인 후보</rdfs:label>\n' +
      '  </owl:NamedIndividual>\n' +
      '\n' +
      '  <owl:NamedIndividual rdf:about="#Diagnosis_New_1">\n' +
      '    <rdf:type rdf:resource="#DiagnosisStep"/>\n' +
      '    <kb:order rdf:datatype="xsd:integer">1</kb:order>\n' +
      '    <kb:has_command>control.sh health</kb:has_command>\n' +
      '    <rdfs:label>진단 절차</rdfs:label>\n' +
      '  </owl:NamedIndividual>\n' +
      '\n' +
      '  <owl:NamedIndividual rdf:about="#Action_New_1">\n' +
      '    <rdf:type rdf:resource="#Action"/>\n' +
      '    <kb:order rdf:datatype="xsd:integer">1</kb:order>\n' +
      '    <kb:has_risk>MEDIUM</kb:has_risk>\n' +
      '    <kb:has_command>control.sh svc-restart &lt;svc&gt;</kb:has_command>\n' +
      '    <rdfs:label>조치</rdfs:label>\n' +
      '  </owl:NamedIndividual>\n' +
      '\n' +
      '  <owl:NamedIndividual rdf:about="#Caveat_New_1">\n' +
      '    <rdf:type rdf:resource="#Caveat"/>\n' +
      '    <kb:order rdf:datatype="xsd:integer">1</kb:order>\n' +
      '    <rdfs:label>주의사항</rdfs:label>\n' +
      '  </owl:NamedIndividual>\n' +
      '\n' +
      '</rdf:RDF>\n')
    setDirty(true); setMsg(null); setValid({ valid: true, error: null })
  }

  async function checkValid() {
    try { const r = await validateKnowledge(content); setValid(r.data); return r.data.valid }
    catch { return true }  // 검증 API 실패는 저장 시 서버가 재검증
  }

  async function save() {
    const path = sel !== '' ? sel : (document.getElementById('kb-newpath')?.value || '').trim()
    if (!path) { setMsg({ type: 'err', text: '경로를 입력하세요 (예: linux/process.md)' }); return }
    setBusy(true); setMsg(null)
    try {
      await saveKnowledgeFile(path, content)
      setMsg({ type: 'ok', text: `저장됨: ${path}` })
      setSel(path); setDirty(false)
      await loadList()
    } catch (e) {
      setMsg({ type: 'err', text: '저장 실패: ' + errText(e) })
    } finally { setBusy(false) }
  }

  async function remove() {
    if (!sel || sel === '') return
    if (!confirm(`정말 삭제할까요?\n${sel}`)) return
    setBusy(true); setMsg(null)
    try {
      await deleteKnowledgeFile(sel)
      setMsg({ type: 'ok', text: `삭제됨: ${sel}` })
      setSel(null); setContent(''); setDirty(false)
      await loadList()
    } catch (e) {
      setMsg({ type: 'err', text: '삭제 실패: ' + errText(e) })
    } finally { setBusy(false) }
  }

  return (
    <div className="p-8 pt-0">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-gray-200">
          <BookOpen size={18} />
          <span className="text-sm font-semibold">장애 지식베이스</span>
          <span className="text-[10px] text-gray-600">{meta.knowledgeDir}</span>
        </div>
        <button onClick={loadList} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white">
          <RefreshCw size={14} /> 새로고침
        </button>
      </div>

      <p className="text-[11px] text-gray-500 mb-4">
        지식 파일은 AI 장애 조사 프롬프트에 주입됩니다. 주입 대상 도메인:{' '}
        <span className="text-gray-300">{(meta.injectedDomains || []).join(', ') || '없음'}</span>
        {' '}(그 외 도메인은 저장은 되지만 아직 주입되지 않습니다). 편집·삭제는 운영자 권한이 필요합니다.
      </p>

      {msg && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${
          msg.type === 'ok' ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'}`}>
          {msg.type === 'ok' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />} {msg.text}
        </div>
      )}

      <div className="grid grid-cols-[260px_1fr] gap-4">
        {/* 파일 목록 */}
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
            <span className="text-xs text-gray-400">파일 {files.length}개</span>
            <button onClick={newFile} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
              <FilePlus size={13} /> 새 파일
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-gray-600 text-xs">로딩 중...</div>
            ) : files.map(f => (
              <button key={f.path} onClick={() => open(f.path)}
                className={`w-full text-left px-3 py-2 border-b border-gray-800/60 hover:bg-gray-800/50 ${
                  sel === f.path ? 'bg-gray-800' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-200">{f.path}</span>
                  {!f.valid && <AlertTriangle size={12} className="text-amber-400" title={f.error} />}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {f.fault_type && <span className="text-[10px] text-gray-500">{f.fault_type}</span>}
                  {!f.injected && <span className="text-[10px] text-gray-600">(미주입)</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 편집기 */}
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
          {sel === null ? (
            <div className="text-center text-gray-600 text-xs py-16">
              왼쪽에서 파일을 선택하거나 "새 파일"을 만드세요.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                {sel === '' ? (
                  <input id="kb-newpath" placeholder="linux/process.xml" className={inputCls + ' max-w-xs'} />
                ) : (
                  <span className="text-xs font-mono text-gray-300">{sel}</span>
                )}
                <div className="flex items-center gap-2">
                  <button onClick={checkValid} disabled={busy}
                    className="text-xs text-gray-400 hover:text-white">검증</button>
                  {sel !== '' && (
                    <button onClick={remove} disabled={busy}
                      className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
                      <Trash2 size={13} /> 삭제
                    </button>
                  )}
                  <button onClick={save} disabled={busy || (!dirty && sel !== '')}
                    className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40">
                    <Save size={13} /> 저장
                  </button>
                </div>
              </div>
              {!valid.ok && (
                <div className="mb-2 px-3 py-1.5 rounded bg-amber-900/40 text-amber-300 text-[11px]">
                  RDF 검증 실패: {valid.error}
                </div>
              )}
              <textarea
                value={content}
                onChange={e => { setContent(e.target.value); setDirty(true) }}
                spellCheck={false}
                className="w-full h-[55vh] px-3 py-2 rounded-lg text-xs font-mono bg-gray-950 border border-gray-700 text-gray-100 outline-none focus:border-blue-500 resize-none"
              />
              <p className="text-[10px] text-gray-600 mt-1">
                형식: RDF/OWL 온톨로지 — <code>owl:NamedIndividual</code>(<code>rdf:type #Fault</code>) 1개 + <code>kb:has_fault_type/has_os/has_target_sw/has_severity</code> 데이터속성 + <code>kb:has_symptom/has_cause/diagnosed_by/resolved_by/has_caveat</code> 로 연결된 개체들(각 <code>kb:order</code>로 순서 지정). 저장 시 사이드카가 경로·RDF 를 재검증합니다.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function errText(e) {
  return e?.response?.data?.error || e?.response?.data?.detail || e?.message || '알 수 없는 오류'
}

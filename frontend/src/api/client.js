import axios from 'axios'
import { getToken, clearAuth } from './token'

const client = axios.create({ baseURL: '/api', timeout: 10000 })

// RBAC: 저장된 토큰을 모든 요청에 Bearer로 첨부
client.interceptors.request.use(cfg => {
  const t = getToken()
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})

// 세션 만료/무효 토큰(401) → 인증정보 제거 후 로그인 전환 (로그인 요청 자체는 제외)
client.interceptors.response.use(
  r => r,
  err => {
    const url = err.config?.url ?? ''
    if (err.response?.status === 401 && !url.includes('/auth/login')) {
      clearAuth()
      window.dispatchEvent(new Event('auth:logout'))
    }
    return Promise.reject(err)
  }
)

// 인증 API
export const login      = (username, password) => client.post('/auth/login', { username, password })
export const createUser = (data)               => client.post('/auth/users', data)

export const getClusters        = ()             => client.get('/clusters')
export const createCluster      = (data)         => client.post('/clusters', data)
export const updateCluster      = (id, data)     => client.put(`/clusters/${id}`, data)
export const deleteCluster      = (id)           => client.delete(`/clusters/${id}`)

export const getClusterStatus   = (id)           => client.get(`/clusters/${id}/status`)
export const getClusterGpfs     = (id)           => client.get(`/clusters/${id}/gpfs`)
export const getClusterAgent    = (id)           => client.get(`/clusters/${id}/agent`)
export const getClusterNetwork  = (id)           => client.get(`/clusters/${id}/network`)
export const triggerFailover    = (id, data)     => client.post(`/clusters/${id}/failover`, data)
export const triggerAppFailover = (id, data)     => client.post(`/clusters/${id}/apps/failover`, data)
export const controlAppService  = (id, data)     => client.post(`/clusters/${id}/apps/control`, data)
export const getAiAnalysis      = (id)           => client.get(`/clusters/${id}/ai-analysis`)

export const getClusterNodes    = (id)           => client.get(`/clusters/${id}/nodes`)
export const createNode         = (id, data)     => client.post(`/clusters/${id}/nodes`, data)
export const updateNode         = (id, nid, data)=> client.put(`/clusters/${id}/nodes/${nid}`, data)
export const deleteNode         = (id, nid)      => client.delete(`/clusters/${id}/nodes/${nid}`)

// Dashboard APIs
export const getDashboardSummary     = ()  => client.get('/dashboard/summary')
export const getDashboardPerformance = ()  => client.get('/dashboard/performance')
export const getDashboardSwStatus    = ()  => client.get('/dashboard/sw-status')
export const getDashboardDocker      = ()  => client.get('/dashboard/docker')
export const getDashboardAlerts      = ()  => client.get('/dashboard/alerts')

// Page APIs
export const getSw                   = ()        => client.get('/sw')
export const getDb                   = ()        => client.get('/db')
export const getDockerContainers     = ()        => client.get('/docker/containers')
export const getDockerImages         = ()        => client.get('/docker/images')
export const getRunbook              = ()        => client.get('/runbook')
export const createRunbook           = (d)       => client.post('/runbook', d)
export const updateRunbookStep       = (id, step)=> client.patch(`/runbook/${id}/step`, { step })
export const getInspections          = ()        => client.get('/inspection')
export const createInspection        = (d)       => client.post('/inspection', d)
export const updateInspection        = (id, d)   => client.put(`/inspection/${id}`, d)
export const deleteInspection        = (id)      => client.delete(`/inspection/${id}`)
export const getReports              = ()        => client.get('/reports')
export const getAlertConfigs         = ()        => client.get('/alerts/config')
export const updateAlertConfig       = (id, d)   => client.put(`/alerts/config/${id}`, d)
export const getSystemSettings       = ()        => client.get('/settings/system')
export const updateSystemSettings    = (d)       => client.put('/settings/system', d)
export const getHaSequences          = (cid)     => client.get(`/ha/sequences/${cid}`)
export const updateHaSequences       = (cid, d)  => client.put(`/ha/sequences/${cid}`, d)
export const getHaHeartbeat          = (cid)     => client.get(`/ha/heartbeat/${cid}`)
export const getHaMetadataSync       = (cid)     => client.get(`/ha/metadata-sync/${cid}`)
export const triggerHaMetadataSync   = (cid)     => client.post(`/ha/metadata-sync/${cid}`)

// SW 스캔 / 등록
export const scanSw              = (nodeId)        => client.get(`/sw/scan?nodeId=${nodeId}`)
export const registerSw          = (data)          => client.post('/sw/register', data)
export const listSw              = (nodeId)        => client.get(`/sw/list?nodeId=${nodeId}`)

// 서비스 CRUD
export const getServices    = ()     => client.get('/services')
export const createService  = (data) => client.post('/services', data)
export const deleteService  = (id)   => client.delete(`/services/${id}`)

// AI 채팅
export const aiChat              = (message)       => client.post('/ai/chat', { message })

// AI 장애 분석
export const triggerAiAnalysis   = (nodeId)        => client.post(`/ai/analyze/${nodeId}`)
export const getAiAnalysisResult = (nodeId)        => client.get(`/ai/analysis/${nodeId}`)
export const executeAgentCommand = (nodeId, data)  => client.post(`/agent/${nodeId}/execute`, data)

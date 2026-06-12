import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import { AuthProvider, useAuth } from './auth/AuthContext'
import Login from './pages/Login'

import Dashboard         from './pages/Dashboard'
import Services          from './pages/Services'
import HaGroups          from './pages/ha/Groups'
import HaSequence        from './pages/ha/Sequence'
import ServerList        from './pages/servers/List'
import Db                from './pages/Db'
import Sw                from './pages/Sw'
import DockerContainers  from './pages/docker/Containers'
import DockerImages      from './pages/docker/Images'
import Inspection        from './pages/Inspection'
import Reports           from './pages/Reports'
import Alerts            from './pages/alerts/Alerts'
import AlertConfig       from './pages/alerts/Config'
import ClustersSettings  from './pages/settings/Clusters'
import AgentsSettings    from './pages/settings/Agents'
import SystemSettings    from './pages/settings/System'

import ClusterTree       from './pages/clusters/Tree'
import ClusterDetail     from './pages/ClusterDetail'
import ClusterSettings   from './pages/ClusterSettings'
import Topology          from './pages/Topology'
import AlertCenter       from './pages/AlertCenter'
import AuditLog          from './pages/AuditLog'
import AiAnalysis        from './pages/AiAnalysis'

import ClusterStatus     from './pages/monitoring/ClusterStatus'

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}

function Gate() {
  const { user } = useAuth()
  if (!user) return <Login />
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          {/* 메인 */}
          <Route path="/"                      element={<Dashboard />} />
          <Route path="/services"              element={<Services />} />

          {/* 클러스터 */}
          <Route path="/clusters/tree"         element={<ClusterTree />} />

          {/* HA */}
          <Route path="/ha/groups"             element={<HaGroups />} />
          <Route path="/ha/sequence"           element={<HaSequence />} />

          {/* 서버 */}
          <Route path="/servers/list"          element={<ServerList />} />
          <Route path="/nodes"                 element={<Navigate to="/servers/list" replace />} />

          {/* DB / SW */}
          <Route path="/db"                    element={<Db />} />
          <Route path="/sw"                    element={<Sw />} />

          {/* Docker */}
          <Route path="/docker/containers"     element={<DockerContainers />} />
          <Route path="/docker/images"         element={<DockerImages />} />

          {/* 모니터링 */}
          <Route path="/monitoring/cluster"    element={<ClusterStatus />} />
          <Route path="/ha/sync"               element={<Navigate to="/monitoring/cluster" replace />} />
          <Route path="/runbook"               element={<Navigate to="/ha/sequence" replace />} />

          {/* 작업 */}
          <Route path="/inspection"            element={<Inspection />} />
          <Route path="/reports"               element={<Reports />} />

          {/* 알람 */}
          <Route path="/alerts"                element={<Alerts />} />
          <Route path="/alerts/config"         element={<AlertConfig />} />

          {/* 설정 */}
          <Route path="/settings/clusters"     element={<ClustersSettings />} />
          <Route path="/settings/agents"       element={<AgentsSettings />} />
          <Route path="/settings/system"       element={<SystemSettings />} />

          {/* 클러스터 상세 (기존) */}
          <Route path="/cluster/:id"           element={<ClusterDetail />} />
          <Route path="/cluster/:id/topology"  element={<Topology />} />
          <Route path="/cluster/:id/settings"  element={<ClusterSettings />} />
          <Route path="/cluster/:id/alerts"    element={<AlertCenter />} />
          <Route path="/cluster/:id/audit"     element={<AuditLog />} />
          <Route path="/ai-analysis"           element={<AiAnalysis />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

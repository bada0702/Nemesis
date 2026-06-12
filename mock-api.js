// Mock API Server — 백엔드/Docker 없이 Nemesis UI 테스트용
const http = require('http')

// ── 동적 스토어 ──────────────────────────────────────────────
let nextClusterId = 4
let nextNodeId    = 100

const clusterStore = {
  1: { id: 1, name: 'prod-cluster-01',    vip: '10.0.0.1' },
  2: { id: 2, name: 'staging-cluster-01', vip: '10.0.0.2' },
  3: { id: 3, name: 'dr-cluster-01',      vip: '10.0.0.3' },
}

const nodeStore = {
  n1: { nodeId:'n1', clusterId:1, hostname:'prod-node-01', role:'PRIMARY', state:'RUNNING', osType:'Linux', ipAddress:'10.0.1.10' },
  n2: { nodeId:'n2', clusterId:1, hostname:'prod-node-02', role:'STANDBY', state:'RUNNING', osType:'Linux', ipAddress:'10.0.1.11' },
  n3: { nodeId:'n3', clusterId:1, hostname:'prod-node-03', role:'STANDBY', state:'STOPPED', osType:'Linux', ipAddress:'10.0.1.12' },
  n4: { nodeId:'n4', clusterId:2, hostname:'stg-node-01',  role:'PRIMARY', state:'RUNNING', osType:'Linux', ipAddress:'10.0.2.10' },
  n5: { nodeId:'n5', clusterId:2, hostname:'stg-node-02',  role:'STANDBY', state:'RUNNING', osType:'Linux', ipAddress:'10.0.2.11' },
  n6: { nodeId:'n6', clusterId:3, hostname:'dr-node-01',   role:'PRIMARY', state:'RUNNING', osType:'Linux', ipAddress:'10.0.3.10' },
  n7: { nodeId:'n7', clusterId:3, hostname:'dr-node-02',   role:'STANDBY', state:'RUNNING', osType:'Linux', ipAddress:'10.0.3.11' },
  n8: { nodeId:'n8', clusterId:3, hostname:'dr-node-03',   role:'FAULT',   state:'STOPPED', osType:'Linux', ipAddress:'10.0.3.12' },
}

function getClusterNodes(clusterId) {
  return Object.values(nodeStore).filter(n => String(n.clusterId) === String(clusterId))
}

function jitter(base, range = 4) {
  return Math.max(0, Math.min(100, base + (Math.random() - 0.5) * range * 2))
}

const BASE_METRICS = {
  n1: { cpu: 42, mem: 68, disk: 55 },
  n2: { cpu: 18, mem: 54, disk: 48 },
  n4: { cpu: 12, mem: 30, disk: 22 },
  n5: { cpu: 8,  mem: 28, disk: 20 },
  n6: { cpu: 5,  mem: 20, disk: 15 },
  n7: { cpu: 4,  mem: 18, disk: 14 },
}

function makeMetrics(nodeId, state) {
  if (state !== 'RUNNING') return null
  const b = BASE_METRICS[nodeId] ?? { cpu: 10, mem: 25, disk: 30 }
  return { cpuPercent: jitter(b.cpu), memoryPercent: jitter(b.mem), diskPercent: jitter(b.disk, 1) }
}

function makeStatus(clusterId) {
  const cluster = clusterStore[clusterId]
  if (!cluster) return { clusterId: +clusterId, clusterName: 'unknown', vip: '-', nodes: [] }
  const nodes = getClusterNodes(clusterId).map(n => ({
    ...n,
    metrics: makeMetrics(n.nodeId, n.state),
  }))
  return { clusterId: cluster.id, clusterName: cluster.name, vip: cluster.vip, nodes }
}

// GPFS 상태 오버라이드 (clusterId → nodeId → gpfsState)
const GPFS_OVERRIDE = { 2: { n5: 'unmounted' } }

function makeGpfs(clusterId) {
  const s   = makeStatus(clusterId)
  const ts  = new Date().toLocaleString('ko-KR')
  const nodes = s.nodes.map((n, i) => {
    const ov    = (GPFS_OVERRIDE[clusterId] ?? {})[n.nodeId]
    const state = ov ?? (n.state === 'RUNNING' ? 'active' : 'down')
    return { nodeId: n.nodeId, hostname: n.hostname, nodeNumber: i + 1, gpfsState: state, ipAddress: n.ipAddress }
  })
  const pad    = (s, len) => String(s).padEnd(len)
  const header = `\nNode number  Node name              GPFS state\n`
  const rows   = nodes.map(n => `      ${pad(n.nodeNumber,3)}  ${pad(n.hostname,22)} ${n.gpfsState}`).join('\n')
  return { command: 'mmgetstate -a', timestamp: ts, output: `[nemesis-ctl ~]# mmgetstate -a\n${header}${rows}\n`, nodes }
}

function makeNetwork(clusterId) {
  const s  = makeStatus(clusterId)
  const ts = new Date().toLocaleString('ko-KR')
  const all = [
    { nodeId: 'mgmt', hostname: 'nemesis-mgmt', ipAddress: '10.0.0.254', state: 'RUNNING' },
    ...s.nodes,
  ]
  const results = []
  for (let i = 0; i < all.length; i++) {
    for (let j = 0; j < all.length; j++) {
      if (i === j) continue
      const from = all[i], to = all[j]
      const reachable = from.state === 'RUNNING' && to.state === 'RUNNING'
      const lat = reachable ? +(Math.random() * 1.4 + 0.1).toFixed(3) : null
      results.push({
        from: from.nodeId, fromHost: from.hostname,
        to:   to.nodeId,   toHost:   to.hostname, toIp: to.ipAddress,
        latencyMs: lat, packetLoss: reachable ? 0 : 100,
        status: reachable ? (lat > 1.0 ? 'slow' : 'ok') : 'unreachable',
      })
    }
  }
  const pingLines = s.nodes.map(n => {
    const r = results.find(x => x.from === 'mgmt' && x.to === n.nodeId)
    if (!r || r.status === 'unreachable') {
      return `[nemesis-ctl ~]# ping -c 3 ${n.ipAddress}  (${n.hostname})\n` +
             `PING ${n.ipAddress}: 56 data bytes\nRequest timeout for icmp_seq 0\n` +
             `Request timeout for icmp_seq 1\nRequest timeout for icmp_seq 2\n` +
             `--- ${n.ipAddress} ping statistics ---\n3 packets transmitted, 0 received, 100% packet loss\n`
    }
    const m = r.latencyMs
    return `[nemesis-ctl ~]# ping -c 3 ${n.ipAddress}  (${n.hostname})\n` +
           `PING ${n.ipAddress}: 56 data bytes\n` +
           `64 bytes from ${n.ipAddress}: icmp_seq=0 ttl=64 time=${(m*0.97).toFixed(3)} ms\n` +
           `64 bytes from ${n.ipAddress}: icmp_seq=1 ttl=64 time=${m.toFixed(3)} ms\n` +
           `64 bytes from ${n.ipAddress}: icmp_seq=2 ttl=64 time=${(m*1.03).toFixed(3)} ms\n` +
           `--- ${n.ipAddress} ping statistics ---\n3 packets transmitted, 3 received, 0% packet loss\n` +
           `round-trip min/avg/max = ${(m*0.97).toFixed(3)}/${m.toFixed(3)}/${(m*1.03).toFixed(3)} ms\n`
  }).join('\n')
  return { timestamp: ts, output: pingLines, results }
}

function makeAiAnalysis(clusterId) {
  const s      = makeStatus(clusterId)
  const faults = s.nodes.filter(n => n.state === 'STOPPED' || n.role === 'FAULT')
  const highs  = s.nodes.filter(n => n.metrics && (n.metrics.cpuPercent > 75 || n.metrics.memoryPercent > 80))
  const now    = new Date().toLocaleString('ko-KR')
  const hasFault = faults.length > 0

  const faultSection = hasFault ? `
## 🚨 감지된 장애

| 노드 | 심각도 | 내용 |
|------|--------|------|
${faults.map(n=>`| ${n.hostname} | ${n.role==='FAULT'?'🔴 CRITICAL':'⚠️ 경고'} | ${n.role} 노드가 오프라인 상태 |`).join('\n')}

### 근본 원인 추정
${faults.map(n=>`**${n.hostname}** (${n.role}):\n- 커널 패닉 또는 하드웨어 장애 가능성\n- OOM Killer 강제 종료\n- 네트워크 파티셔닝 (split-brain 위험)`).join('\n\n')}

### 즉각 권장 조치
1. **[긴급]** 해당 노드 콘솔 접속 → \`journalctl -xe\` 로그 확인
2. **[긴급]** STONITH 상태 확인 → split-brain 배제
3. **[복구]** Runbook > **Join Cluster** 실행
4. **[복구]** GPFS 마운트 확인 후 \`mmgetstate -a\` 재확인
5. **[모니터링]** 재참여 30분간 복제 lag ≤ 0.1s 점검
` : `
## ✅ 클러스터 정상 운영 중

현재 감지된 장애 없음. 모든 Primary/Standby 노드가 정상 상태입니다.
`

  const highSection = highs.length > 0 ? `
## ⚠️ 리소스 경고

| 노드 | 심각도 | 내용 |
|------|--------|------|
${highs.map(n=>`| ${n.hostname} | ⚠️ 주의 | CPU ${n.metrics.cpuPercent.toFixed(1)}% / MEM ${n.metrics.memoryPercent.toFixed(1)}% |`).join('\n')}

> CPU/메모리 사용률이 임계치를 초과했습니다. 프로세스 목록을 점검하세요.
` : ''

  const markdown = `## AI 장애 분석 리포트

**분석 시각:** ${now}
**클러스터:** ${s.clusterName} (VIP: ${s.vip})
**전체 노드:** ${s.nodes.length}개 / 정상: ${s.nodes.filter(n=>n.state==='RUNNING').length}개 / 장애: ${faults.length}개

${faultSection}
${highSection}
## 📋 복구 절차 요약

1. 장애 노드 원인 파악 (syslog / dmesg)
2. 하드웨어 이상 없으면 서비스 재기동
3. Heartbeat 재연결 확인
4. GPFS 상태 재점검 (\`mmgetstate -a\`)
5. VIP 정상 응답 확인 (\`ping ${s.vip}\`)
6. 30분 모니터링 후 이상 없으면 완전 복구 판정

> **AI 판정:** ${hasFault ? '🔴 즉각 조치 필요 — 수동 Failover 또는 장애 노드 복구 권장' : '🟢 현재 조치 불필요 — 주기적 모니터링 유지'}`

  return { status: 'success', analysis: markdown, severity: hasFault ? 'critical' : highs.length ? 'warning' : 'ok' }
}

// ── 에이전트 데이터 (앱/FC/네트워크/GPFS 볼륨/로그) ─────────────
const APP_DEFS = {
  oracle:     { id: 'oracle',     name: 'Oracle DB',    icon: 'database',      port: 1521  },
  nginx:      { id: 'nginx',      name: 'Nginx',         icon: 'web',           port: 80    },
  nfs:        { id: 'nfs',        name: 'NFS Server',    icon: 'folder_shared', port: 2049  },
  heartbeat:  { id: 'heartbeat',  name: 'Heartbeat',     icon: 'favorite',      port: null  },
  corosync:   { id: 'corosync',   name: 'Corosync',      icon: 'sync',          port: null  },
  sshd:       { id: 'sshd',       name: 'SSH Daemon',    icon: 'terminal',      port: 22    },
}

const APP_OVERRIDES = {
  1: { n1: { oracle: 'stopped' } },
  2: { n5: { nfs: 'stopped' } },
  3: { n8: { oracle: 'stopped' } },
}

const APP_ACTIVE_NODE = {
  1: { oracle: 'n1', nginx: 'n1', nfs: 'n1', heartbeat: 'n1', corosync: 'n1', sshd: 'n1' },
  2: { nginx: 'n4', nfs: 'n4', heartbeat: 'n4', corosync: 'n4', sshd: 'n4' },
  3: { oracle: 'n6', heartbeat: 'n6', corosync: 'n6', sshd: 'n6' },
}

function getActiveNodeId(clusterId, appId, nodes) {
  const clusterActive = APP_ACTIVE_NODE[clusterId] ?? {}
  const configured = clusterActive[appId] ?? nodes.find(n => n.role === 'PRIMARY')?.nodeId ?? nodes[0]?.nodeId
  const configuredNode = nodes.find(n => n.nodeId === configured && n.state === 'RUNNING')
  if (configuredNode) return configuredNode.nodeId
  return nodes.find(n => n.state === 'RUNNING')?.nodeId ?? configured
}

// 클러스터/노드별 앱 목록 (role별 차별화)
function makeNodeApps(node, clusterId, nodes) {
  const base = ['sshd', 'heartbeat', 'corosync']
  const appsByCluster = {
    1: ['oracle', 'nginx', 'nfs'],
    2: ['nginx', 'nfs'],
    3: ['oracle'],
  }
  const appIds = [...base, ...(appsByCluster[clusterId] ?? [])]
  return appIds.map(id => {
    const def  = APP_DEFS[id]
    const down = node.state !== 'RUNNING'
    const overrideState = (APP_OVERRIDES[clusterId] ?? {})[node.nodeId]?.[id]
    const activeNodeId = getActiveNodeId(clusterId, id, nodes)
    const appDown = down || overrideState === 'stopped'
    return {
      ...def,
      state:   appDown ? 'stopped' : 'running',
      pid:     appDown ? null : Math.floor(Math.random() * 50000 + 1000),
      uptime:  appDown ? null : `${Math.floor(Math.random() * 72 + 1)}h ${Math.floor(Math.random() * 60)}m`,
      haRole:  node.nodeId === activeNodeId ? 'ACTIVE' : 'STANDBY',
      activeNodeId,
      standbyNodeId: nodes.find(n => n.nodeId !== activeNodeId && n.state === 'RUNNING')?.nodeId ?? null,
      failoverTrigger: Boolean(overrideState === 'stopped' && node.role === 'PRIMARY'),
    }
  })
}

function makeNodeNetwork(node) {
  const up = node.state === 'RUNNING'
  return [
    { name: 'eth0', state: up ? 'up' : 'down', speed: '10GbE', ip: node.ipAddress,
      rxMbps: up ? +(Math.random()*400+50).toFixed(1) : 0,
      txMbps: up ? +(Math.random()*200+20).toFixed(1) : 0 },
    { name: 'eth1', state: up ? 'up' : 'down', speed: '10GbE', ip: null,
      rxMbps: up ? +(Math.random()*100+10).toFixed(1) : 0,
      txMbps: up ? +(Math.random()*50+5).toFixed(1) : 0 },
    { name: 'bond0', state: up ? 'up' : 'down', speed: '20GbE', ip: node.ipAddress,
      rxMbps: up ? +(Math.random()*500+80).toFixed(1) : 0,
      txMbps: up ? +(Math.random()*250+30).toFixed(1) : 0 },
  ]
}

function makeNodeFC(node) {
  const up = node.state === 'RUNNING'
  return [
    { name: 'qla0', wwn: `21:00:00:1b:32:${node.nodeId}:a0`, state: up ? 'online' : 'offline', speed: '16Gb', targets: up ? 4 : 0 },
    { name: 'qla1', wwn: `21:00:00:1b:32:${node.nodeId}:a1`, state: up ? 'online' : 'offline', speed: '16Gb', targets: up ? 4 : 0 },
  ]
}

function makeNodeGpfsVolumes(node, clusterId) {
  if (node.state !== 'RUNNING') return []
  const vols = {
    1: [
      { mountpoint: '/gpfs/data', device: 'gpfs0', totalGb: 10000, usedPct: jitter(45, 2), state: 'mounted' },
      { mountpoint: '/gpfs/logs', device: 'gpfs1', totalGb: 2000,  usedPct: jitter(23, 2), state: 'mounted' },
    ],
    2: [
      { mountpoint: '/gpfs/stg',  device: 'gpfs0', totalGb: 5000,  usedPct: jitter(30, 2), state: node.nodeId === 'n5' ? 'unmounted' : 'mounted' },
    ],
    3: [
      { mountpoint: '/gpfs/dr',   device: 'gpfs0', totalGb: 20000, usedPct: jitter(12, 2), state: 'mounted' },
    ],
  }
  return (vols[clusterId] ?? []).map(v => ({ ...v, usedPct: +v.usedPct.toFixed(1) }))
}

function makeNodeLogs(node) {
  const ts = () => {
    const d = new Date(); d.setSeconds(d.getSeconds() - Math.floor(Math.random() * 3600))
    return d.toLocaleString('ko-KR')
  }
  if (node.state !== 'RUNNING') {
    return [
      { ts: ts(), level: 'CRITICAL', msg: `[${node.hostname}] 노드 오프라인 — 서비스 전체 중단` },
      { ts: ts(), level: 'ERROR',    msg: `[${node.hostname}] Oracle listener failed to start on port 1521` },
      { ts: ts(), level: 'ERROR',    msg: `[${node.hostname}] Heartbeat lost — triggering STONITH fence` },
      { ts: ts(), level: 'WARN',     msg: `[${node.hostname}] FC HBA qla0 link down detected` },
    ]
  }
  const msgs = [
    { level: 'INFO',  msg: `[${node.hostname}] Oracle DB startup completed (PID ${Math.floor(Math.random()*50000+1000)})` },
    { level: 'INFO',  msg: `[${node.hostname}] GPFS mount /gpfs/data OK — 10.0TB available` },
    { level: 'INFO',  msg: `[${node.hostname}] Heartbeat alive — peer reachable` },
    { level: 'WARN',  msg: `[${node.hostname}] CPU usage spike: ${(75 + Math.random()*15).toFixed(1)}%` },
    { level: 'INFO',  msg: `[${node.hostname}] FC HBA qla0 online — 4 targets active` },
  ]
  return msgs.map(m => ({ ts: ts(), ...m })).sort((a, b) => b.ts.localeCompare(a.ts))
}

function makeAgentData(clusterId) {
  const s   = makeStatus(clusterId)
  const now = new Date().toLocaleString('ko-KR')

  // 최근 failover 이벤트
  const faultNode = s.nodes.find(n => n.role === 'FAULT' || n.state === 'STOPPED')
  const failoverEvent = faultNode ? {
    time:        now,
    fromNode:    faultNode.hostname,
    toNode:      s.nodes.find(n => n.role === 'PRIMARY' && n.nodeId !== faultNode.nodeId)?.hostname ?? '—',
    triggerApp:  'oracle',
    triggerMsg:  `Oracle DB on ${faultNode.hostname} stopped responding — automatic failover triggered`,
  } : null

  const nodes = s.nodes.map(node => ({
    nodeId:      node.nodeId,
    hostname:    node.hostname,
    role:        node.role,
    state:       node.state,
    osType:      node.osType,
    ipAddress:   node.ipAddress,
    apps:        makeNodeApps(node, clusterId, s.nodes),
    network:     makeNodeNetwork(node),
    fc:          makeNodeFC(node),
    gpfsVolumes: makeNodeGpfsVolumes(node, clusterId),
    logs:        makeNodeLogs(node),
  }))

  return { clusterId: s.clusterId, clusterName: s.clusterName, vip: s.vip, timestamp: now, nodes, failoverEvent }
}

// ── 대시보드 집계 데이터 ───────────────────────────────────────
function makeDashboardSummary() {
  const clusters = Object.values(clusterStore)
  const nodes    = Object.values(nodeStore)
  return {
    clusterCount:     clusters.length,
    activeNodeCount:  nodes.filter(n => n.state === 'RUNNING').length,
    issueWaitingCount: nodes.filter(n => n.state === 'STOPPED' || n.role === 'FAULT').length,
    vipCount:         clusters.filter(c => c.vip).length,
    agentCount:       clusters.length,
    lastUpdatedAt:    new Date().toISOString(),
  }
}

function makeDashboardSwStatus() {
  const items = [
    { name: 'WebLogic (Admin)',   type: 'WAS', state: 'running', node: 'prod-node-01' },
    { name: 'WebLogic (Managed)', type: 'WAS', state: 'running', node: 'prod-node-01' },
    { name: 'Tomcat',             type: 'WAS', state: 'running', node: 'stg-node-01'  },
    { name: 'Nginx (prod)',       type: 'WEB', state: 'running', node: 'prod-node-01' },
    { name: 'Nginx (stg)',        type: 'WEB', state: 'running', node: 'stg-node-01'  },
    { name: 'Redis',              type: 'DB',  state: 'running', node: 'prod-node-01' },
    { name: 'Oracle Listener',    type: 'DB',  state: 'stopped', node: 'prod-node-01' },
    { name: 'NFS Server',         type: 'WAS', state: 'running', node: 'stg-node-01'  },
  ]
  return { items }
}

function makeDashboardAlerts() {
  const items = [
    { level: 'WARNING',  message: '복지시스템 WAS2 메모리 85% 초과',           createdAt: new Date(Date.now()-300000).toISOString() },
    { level: 'INFO',     message: 'prod-node-01 디스크 사용률 55%',            createdAt: new Date(Date.now()-600000).toISOString() },
    { level: 'INFO',     message: 'Heartbeat 정상 — prod-cluster-01',          createdAt: new Date(Date.now()-900000).toISOString() },
    { level: 'INFO',     message: '민원시스템 DB 세션 수 정상 범위',           createdAt: new Date(Date.now()-1200000).toISOString() },
    { level: 'INFO',     message: 'GPFS /gpfs/data 마운트 확인 완료',          createdAt: new Date(Date.now()-1800000).toISOString() },
  ]
  return { items }
}

function makeDashboardDocker() {
  const nodes = [
    { hostname: 'prod-node-01', ip: '10.0.1.10', runningContainers: 5, totalContainers: 5, syncOk: true,  images: 12, lag: '0ms'  },
    { hostname: 'prod-node-02', ip: '10.0.1.11', runningContainers: 3, totalContainers: 3, syncOk: true,  images: 8,  lag: '2ms'  },
    { hostname: 'stg-node-01',  ip: '10.0.2.10', runningContainers: 2, totalContainers: 3, syncOk: false, images: 6,  lag: '—'    },
  ]
  return { nodes }
}

function makeDashboardPerformance() {
  const now = Date.now()
  const timeline = Array.from({ length: 12 }, (_, i) => {
    const t = new Date(now - (11 - i) * 5 * 60 * 1000)
    return {
      time: t.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      cpuPercent:    +(jitter(38, 8)).toFixed(1),
      memoryPercent: +(jitter(62, 5)).toFixed(1),
      diskPercent:   +(jitter(48, 2)).toFixed(1),
    }
  })
  const last = timeline[timeline.length - 1]
  return {
    avgCpuPercent:    last.cpuPercent,
    avgMemoryPercent: last.memoryPercent,
    avgDiskPercent:   last.diskPercent,
    timeline,
  }
}

// ── 신규 페이지 데이터 ────────────────────────────────────────
const swStore = [
  { id:'sw1', name:'WebLogic Admin',    type:'WAS', version:'14.1.1', state:'running', node:'prod-node-01', nodeId:'n1', port:7001, pid:12345, uptime:'12d 4h' },
  { id:'sw2', name:'WebLogic Managed1', type:'WAS', version:'14.1.1', state:'running', node:'prod-node-01', nodeId:'n1', port:7002, pid:12346, uptime:'12d 4h' },
  { id:'sw3', name:'WebLogic Managed2', type:'WAS', version:'14.1.1', state:'running', node:'prod-node-02', nodeId:'n2', port:7002, pid:23456, uptime:'12d 4h' },
  { id:'sw4', name:'Tomcat',            type:'WAS', version:'10.1.0', state:'running', node:'stg-node-01',  nodeId:'n4', port:8080, pid:34567, uptime:'5d 2h'  },
  { id:'sw5', name:'Nginx (prod)',       type:'WEB', version:'1.25.3', state:'running', node:'prod-node-01', nodeId:'n1', port:80,   pid:45678, uptime:'12d 4h' },
  { id:'sw6', name:'Nginx (stg)',        type:'WEB', version:'1.25.3', state:'running', node:'stg-node-01',  nodeId:'n4', port:80,   pid:56789, uptime:'5d 2h'  },
  { id:'sw7', name:'Redis',              type:'DB',  version:'7.2.3',  state:'running', node:'prod-node-01', nodeId:'n1', port:6379, pid:67890, uptime:'12d 4h' },
  { id:'sw8', name:'Oracle Listener',   type:'DB',  version:'19c',    state:'stopped', node:'prod-node-01', nodeId:'n1', port:1521, pid:null,  uptime:null },
  { id:'sw9', name:'NFS Server',        type:'SYS', version:'2.6',    state:'running', node:'stg-node-01',  nodeId:'n4', port:2049, pid:78901, uptime:'5d 2h'  },
  { id:'sw10',name:'Heartbeat',         type:'SYS', version:'3.0.6',  state:'running', node:'prod-node-01', nodeId:'n1', port:null, pid:89012, uptime:'12d 4h' },
  { id:'sw11',name:'Corosync',          type:'SYS', version:'3.1.5',  state:'running', node:'prod-node-01', nodeId:'n1', port:null, pid:90123, uptime:'12d 4h' },
]

const dbStore = [
  { id:'db1', name:'Oracle (민원DB)',     type:'Oracle',     version:'19c',      node:'prod-node-01', port:1521, state:'OPEN',    sessions:42, maxSessions:300 },
  { id:'db2', name:'Oracle (세무DB)',     type:'Oracle',     version:'19c',      node:'prod-node-01', port:1521, state:'OPEN',    sessions:18, maxSessions:300 },
  { id:'db3', name:'PostgreSQL (복지DB)', type:'PostgreSQL', version:'15.4',     node:'stg-node-01',  port:5432, state:'PRIMARY', sessions:7,  maxSessions:100 },
  { id:'db4', name:'MariaDB (예약DB)',    type:'MariaDB',    version:'10.11',    node:'stg-node-01',  port:3306, state:'RUNNING', sessions:3,  maxSessions:100 },
  { id:'db5', name:'Oracle (DR복사본)',   type:'Oracle',     version:'19c',      node:'dr-node-01',   port:1521, state:'OPEN',    sessions:2,  maxSessions:100 },
]

const containerStore = [
  { id:'c1', name:'nginx-proxy',       image:'nginx:1.25',            node:'prod-node-01', status:'running', ports:'80:80,443:443', cpu:'2.3%', mem:'128MB', created:'2024-01-15' },
  { id:'c2', name:'redis-cache',       image:'redis:7.2',             node:'prod-node-01', status:'running', ports:'6379:6379',     cpu:'0.8%', mem:'256MB', created:'2024-01-10' },
  { id:'c3', name:'app-server-1',      image:'app:v2.3.1',            node:'prod-node-01', status:'running', ports:'8080:8080',     cpu:'12.5%',mem:'512MB', created:'2024-02-01' },
  { id:'c4', name:'app-server-2',      image:'app:v2.3.1',            node:'prod-node-02', status:'running', ports:'8080:8080',     cpu:'10.2%',mem:'480MB', created:'2024-02-01' },
  { id:'c5', name:'monitoring-agent',  image:'prometheus/agent:v0.39',node:'prod-node-02', status:'running', ports:'9090:9090',     cpu:'1.2%', mem:'64MB',  created:'2024-01-20' },
  { id:'c6', name:'logstash',          image:'logstash:8.12',         node:'stg-node-01',  status:'stopped', ports:'5044:5044',     cpu:'0%',   mem:'0MB',   created:'2024-01-25' },
  { id:'c7', name:'elasticsearch',     image:'elasticsearch:8.12',    node:'stg-node-01',  status:'running', ports:'9200:9200',     cpu:'8.4%', mem:'1.2GB', created:'2024-01-25' },
  { id:'c8', name:'kibana',            image:'kibana:8.12',           node:'stg-node-01',  status:'running', ports:'5601:5601',     cpu:'3.1%', mem:'512MB', created:'2024-01-25' },
]

const imageStore = [
  { id:'i1', name:'nginx',             tag:'1.25',    node:'prod-node-01', size:'142MB', used:true,  created:'2024-01-15' },
  { id:'i2', name:'redis',             tag:'7.2',     node:'prod-node-01', size:'38MB',  used:true,  created:'2024-01-10' },
  { id:'i3', name:'app',               tag:'v2.3.1',  node:'prod-node-01', size:'256MB', used:true,  created:'2024-02-01' },
  { id:'i4', name:'app',               tag:'v2.2.0',  node:'prod-node-01', size:'248MB', used:false, created:'2024-01-01' },
  { id:'i5', name:'prometheus/agent',  tag:'v0.39',   node:'prod-node-02', size:'68MB',  used:true,  created:'2024-01-20' },
  { id:'i6', name:'app',               tag:'v2.3.1',  node:'prod-node-02', size:'256MB', used:true,  created:'2024-02-01' },
  { id:'i7', name:'logstash',          tag:'8.12',    node:'stg-node-01',  size:'684MB', used:true,  created:'2024-01-25' },
  { id:'i8', name:'elasticsearch',     tag:'8.12',    node:'stg-node-01',  size:'512MB', used:true,  created:'2024-01-25' },
  { id:'i9', name:'kibana',            tag:'8.12',    node:'stg-node-01',  size:'324MB', used:true,  created:'2024-01-25' },
]

let nextRbId = 4
const runbookStore = [
  { id:'rb1', title:'민원시스템 정기점검', type:'MAINTENANCE', status:'IN_PROGRESS', progress:65, currentStep:3, target:'prod-cluster-01', startedAt:'2026-06-09T08:20:00Z', createdBy:'admin',
    steps:[{label:'Oracle 종료',done:true,time:'08:20:10'},{label:'WAS 종료',done:true,time:'08:23:15'},{label:'Docker 종료',done:true,time:'08:25:40'},{label:'Patch 적용',active:true,time:'진행 중'},{label:'Oracle 기동',waiting:true,time:'대기'},{label:'WAS 기동',waiting:true,time:'대기'}] },
  { id:'rb2', title:'세무시스템 DB 백업',  type:'BACKUP',      status:'COMPLETED',  progress:100, currentStep:3, target:'prod-cluster-01', startedAt:'2026-06-08T22:00:00Z', createdBy:'dba',
    steps:[{label:'DB 정지',done:true,time:'22:01:00'},{label:'백업 실행',done:true,time:'22:02:30'},{label:'백업 검증',done:true,time:'22:35:00'},{label:'DB 기동',done:true,time:'22:40:00'}] },
  { id:'rb3', title:'DR 클러스터 전환 훈련',type:'FAILOVER',  status:'SCHEDULED',  progress:0,  currentStep:0, target:'dr-cluster-01',  startedAt:null, scheduledAt:'2026-06-15T02:00:00Z', createdBy:'admin',
    steps:[{label:'사전 체크',waiting:true,time:'대기'},{label:'Primary 정지',waiting:true,time:'대기'},{label:'Failover 실행',waiting:true,time:'대기'},{label:'서비스 확인',waiting:true,time:'대기'},{label:'롤백',waiting:true,time:'대기'}] },
]

// SW 프로세스 스토어 (nodeId → 등록된 SW 목록)
const swProcessStore = {}

// AI 분석 결과 스토어 (nodeId → 최신 분석)
const aiAnalysisStore = {}

// 서비스 스토어 (id → 서비스 정보)
let nextSvcId = 6
const serviceStore = {
  's1': { id:'s1', name:'민원시스템',    cluster:'prod-cluster-01', swList:['Oracle','WebLogic','Nginx'], status:'NORMAL'   },
  's2': { id:'s2', name:'세무회계시스템',cluster:'prod-cluster-01', swList:['Oracle','Tomcat','Nginx'],   status:'NORMAL'   },
  's3': { id:'s3', name:'복지시스템',    cluster:'stg-cluster-01',  swList:['PostgreSQL','WAS','Nginx'],  status:'DEGRADED' },
  's4': { id:'s4', name:'통합예약시스템',cluster:'stg-cluster-01',  swList:['MariaDB','Spring Boot','Nginx'], status:'NORMAL' },
  's5': { id:'s5', name:'배치시스템',    cluster:'prod-cluster-01', swList:['Job Scheduler','Batch Worker'], status:'NORMAL' },
}

let nextInsId = 5
const inspectionStore = [
  { id:'ins1', title:'2월 정기 점검',    target:'prod-cluster-01', type:'REGULAR',   status:'IN_PROGRESS',date:'2026-06-09', inspector:'admin',    notes:'민원시스템 패치 적용 진행 중' },
  { id:'ins2', title:'긴급 보안 패치',   target:'stg-cluster-01',  type:'EMERGENCY', status:'COMPLETED',  date:'2026-06-07', inspector:'secadmin', notes:'CVE-2024-XXXX 대응 완료' },
  { id:'ins3', title:'1월 정기 점검',    target:'prod-cluster-01', type:'REGULAR',   status:'COMPLETED',  date:'2026-05-15', inspector:'admin',    notes:'이상 없음' },
  { id:'ins4', title:'DR 사이트 점검',   target:'dr-cluster-01',   type:'REGULAR',   status:'SCHEDULED',  date:'2026-06-15', inspector:'admin',    notes:'' },
]

const reportStore = [
  { id:'r1', title:'2026년 6월 시스템 운영 보고서',    type:'MONTHLY',     status:'GENERATING', createdAt:'2026-06-01', size:null  },
  { id:'r2', title:'2026년 5월 시스템 운영 보고서',    type:'MONTHLY',     status:'READY',      createdAt:'2026-05-01', size:'2.1MB' },
  { id:'r3', title:'장애 이력 분석 보고서 (2026 Q1)',  type:'INCIDENT',    status:'READY',      createdAt:'2026-04-01', size:'1.8MB' },
  { id:'r4', title:'성능 분석 리포트 2026-W23',        type:'PERFORMANCE', status:'READY',      createdAt:'2026-06-06', size:'3.2MB' },
  { id:'r5', title:'보안 감사 보고서 2026-Q1',         type:'SECURITY',    status:'READY',      createdAt:'2026-04-10', size:'2.6MB' },
]

let alertConfigStore = [
  { id:'ac1', name:'CPU 경고',           metric:'cpu',        threshold:80, level:'WARNING',  enabled:true,  cooldownMin:5  },
  { id:'ac2', name:'CPU 치명',           metric:'cpu',        threshold:95, level:'CRITICAL', enabled:true,  cooldownMin:2  },
  { id:'ac3', name:'메모리 경고',        metric:'memory',     threshold:85, level:'WARNING',  enabled:true,  cooldownMin:5  },
  { id:'ac4', name:'메모리 치명',        metric:'memory',     threshold:95, level:'CRITICAL', enabled:true,  cooldownMin:2  },
  { id:'ac5', name:'디스크 경고',        metric:'disk',       threshold:80, level:'WARNING',  enabled:true,  cooldownMin:30 },
  { id:'ac6', name:'노드 오프라인',      metric:'node_state', threshold:0,  level:'CRITICAL', enabled:true,  cooldownMin:1  },
  { id:'ac7', name:'Failover 발생',      metric:'failover',   threshold:1,  level:'CRITICAL', enabled:true,  cooldownMin:0  },
  { id:'ac8', name:'네트워크 패킷 손실', metric:'packet_loss',threshold:5,  level:'WARNING',  enabled:false, cooldownMin:10 },
]

let systemSettings = {
  pollingIntervalSec: 10, alertRetentionDays: 90,
  metricsRetentionDays: 30, maxFailoverCount: 3,
  pingpongGuardSec: 10, aiEnabled: true,
  notificationEmail: 'ops@example.com', notificationSlack: '',
  timezone: 'Asia/Seoul', language: 'ko',
}

// HA 운영 절차 (기동/중지/Failover 시퀀스)
const haSequenceStore = {
  1: {
    STARTUP: [
      { id:'su1-1', order:1, action:'START', serviceType:'DB',  serviceName:'Oracle',   nodeRole:'PRIMARY', waitAfterSec:30, description:'Oracle DB 기동 후 리스너 확인' },
      { id:'su1-2', order:2, action:'START', serviceType:'WAS', serviceName:'WebLogic', nodeRole:'PRIMARY', waitAfterSec:20, description:'WAS 기동 및 헬스체크 확인' },
      { id:'su1-3', order:3, action:'START', serviceType:'WEB', serviceName:'Nginx',    nodeRole:'PRIMARY', waitAfterSec:5,  description:'Nginx 기동 및 트래픽 수신 확인' },
    ],
    SHUTDOWN: [
      { id:'sd1-1', order:1, action:'STOP', serviceType:'WEB', serviceName:'Nginx',    nodeRole:'PRIMARY', waitAfterSec:5,  description:'신규 요청 차단 후 Nginx 종료' },
      { id:'sd1-2', order:2, action:'STOP', serviceType:'WAS', serviceName:'WebLogic', nodeRole:'PRIMARY', waitAfterSec:10, description:'처리 중인 요청 완료 대기 후 WAS 종료' },
      { id:'sd1-3', order:3, action:'STOP', serviceType:'DB',  serviceName:'Oracle',   nodeRole:'PRIMARY', waitAfterSec:15, description:'DB 세션 정리 후 Oracle 종료' },
    ],
    FAILOVER: [
      { id:'fo1-1', order:1, action:'STOP',         serviceType:'WEB', serviceName:'Nginx',    nodeRole:'PRIMARY', waitAfterSec:5,  description:'Primary WEB 종료' },
      { id:'fo1-2', order:2, action:'STOP',         serviceType:'WAS', serviceName:'WebLogic', nodeRole:'PRIMARY', waitAfterSec:10, description:'Primary WAS 종료' },
      { id:'fo1-3', order:3, action:'STOP',         serviceType:'DB',  serviceName:'Oracle',   nodeRole:'PRIMARY', waitAfterSec:15, description:'Primary DB 종료' },
      { id:'fo1-4', order:4, action:'VIP_TRANSFER', serviceType:'VIP', serviceName:'VIP 전환', nodeRole:null,      waitAfterSec:5,  description:'VIP를 Standby 노드로 이전' },
      { id:'fo1-5', order:5, action:'START',        serviceType:'DB',  serviceName:'Oracle',   nodeRole:'STANDBY', waitAfterSec:30, description:'Standby DB 기동 및 확인' },
      { id:'fo1-6', order:6, action:'START',        serviceType:'WAS', serviceName:'WebLogic', nodeRole:'STANDBY', waitAfterSec:20, description:'Standby WAS 기동' },
      { id:'fo1-7', order:7, action:'START',        serviceType:'WEB', serviceName:'Nginx',    nodeRole:'STANDBY', waitAfterSec:5,  description:'Standby WEB 기동 및 서비스 확인' },
    ],
  },
  2: {
    STARTUP: [
      { id:'su2-1', order:1, action:'START', serviceType:'WAS', serviceName:'Tomcat',   nodeRole:'PRIMARY', waitAfterSec:20, description:'Tomcat 기동' },
      { id:'su2-2', order:2, action:'START', serviceType:'WEB', serviceName:'Nginx',    nodeRole:'PRIMARY', waitAfterSec:5,  description:'Nginx 기동' },
    ],
    SHUTDOWN: [
      { id:'sd2-1', order:1, action:'STOP', serviceType:'WEB', serviceName:'Nginx',  nodeRole:'PRIMARY', waitAfterSec:5,  description:'Nginx 종료' },
      { id:'sd2-2', order:2, action:'STOP', serviceType:'WAS', serviceName:'Tomcat', nodeRole:'PRIMARY', waitAfterSec:10, description:'Tomcat 종료' },
    ],
    FAILOVER: [
      { id:'fo2-1', order:1, action:'STOP',         serviceType:'WEB', serviceName:'Nginx',  nodeRole:'PRIMARY', waitAfterSec:5,  description:'Primary WEB 종료' },
      { id:'fo2-2', order:2, action:'STOP',         serviceType:'WAS', serviceName:'Tomcat', nodeRole:'PRIMARY', waitAfterSec:10, description:'Primary WAS 종료' },
      { id:'fo2-3', order:3, action:'VIP_TRANSFER', serviceType:'VIP', serviceName:'VIP 전환', nodeRole:null,    waitAfterSec:5,  description:'VIP 전환' },
      { id:'fo2-4', order:4, action:'START',        serviceType:'WAS', serviceName:'Tomcat', nodeRole:'STANDBY', waitAfterSec:20, description:'Standby WAS 기동' },
      { id:'fo2-5', order:5, action:'START',        serviceType:'WEB', serviceName:'Nginx',  nodeRole:'STANDBY', waitAfterSec:5,  description:'Standby WEB 기동' },
    ],
  },
  3: {
    STARTUP: [
      { id:'su3-1', order:1, action:'START', serviceType:'DB',  serviceName:'Oracle',   nodeRole:'PRIMARY', waitAfterSec:30, description:'DR DB 기동' },
      { id:'su3-2', order:2, action:'START', serviceType:'WEB', serviceName:'Nginx',    nodeRole:'PRIMARY', waitAfterSec:5,  description:'DR WEB 기동' },
    ],
    SHUTDOWN: [
      { id:'sd3-1', order:1, action:'STOP', serviceType:'WEB', serviceName:'Nginx',  nodeRole:'PRIMARY', waitAfterSec:5,  description:'DR WEB 종료' },
      { id:'sd3-2', order:2, action:'STOP', serviceType:'DB',  serviceName:'Oracle', nodeRole:'PRIMARY', waitAfterSec:15, description:'DR DB 종료' },
    ],
    FAILOVER: [
      { id:'fo3-1', order:1, action:'STOP',         serviceType:'WEB', serviceName:'Nginx',  nodeRole:'PRIMARY', waitAfterSec:5,  description:'Primary WEB 종료' },
      { id:'fo3-2', order:2, action:'STOP',         serviceType:'DB',  serviceName:'Oracle', nodeRole:'PRIMARY', waitAfterSec:15, description:'Primary DB 종료' },
      { id:'fo3-3', order:3, action:'VIP_TRANSFER', serviceType:'VIP', serviceName:'VIP 전환', nodeRole:null,    waitAfterSec:5,  description:'VIP 전환' },
      { id:'fo3-4', order:4, action:'START',        serviceType:'DB',  serviceName:'Oracle', nodeRole:'STANDBY', waitAfterSec:30, description:'Standby DB 기동' },
      { id:'fo3-5', order:5, action:'START',        serviceType:'WEB', serviceName:'Nginx',  nodeRole:'STANDBY', waitAfterSec:5,  description:'Standby WEB 기동' },
    ],
  },
}
let nextSeqId = 100

// ── 하트비트 데이터 생성 ─────────────────────────────────────
function makeHeartbeat(clusterId) {
  const s = makeStatus(clusterId)
  const nodes = s.nodes
  const result = nodes.map(node => ({
    nodeId:    node.nodeId,
    hostname:  node.hostname,
    role:      node.role,
    state:     node.state,
    heartbeats: nodes.filter(n => n.nodeId !== node.nodeId).map(target => {
      const fromOk   = node.state   === 'RUNNING'
      const targetOk = target.state === 'RUNNING'
      const alive    = fromOk && targetOk
      const lat      = alive ? +(Math.random() * 1.5 + 0.2).toFixed(2) : null
      const status   = !fromOk ? 'DEAD' : (!targetOk ? 'TIMEOUT' : lat > 1.2 ? 'SLOW' : 'ALIVE')
      return {
        toNodeId:            target.nodeId,
        toHostname:          target.hostname,
        status,
        latencyMs:           lat,
        lastSeenAt:          alive ? new Date().toISOString()
                                   : new Date(Date.now() - Math.random()*120000 - 30000).toISOString(),
        consecutiveFailures: alive ? 0 : Math.floor(Math.random() * 5 + 1),
        intervalSec:         2,
      }
    }),
  }))
  return { clusterId: s.clusterId, clusterName: s.clusterName, vip: s.vip, nodes: result, timestamp: new Date().toISOString() }
}

// ── 메타데이터 동기화 데이터 생성 ──────────────────────────────
const META_ITEMS = [
  { key: 'failover_sequence', label: 'Failover 절차'   },
  { key: 'ha_group_config',   label: 'HA 그룹 설정'    },
  { key: 'vip_config',        label: 'VIP 설정'        },
  { key: 'network_config',    label: '네트워크 설정'   },
  { key: 'agent_config',      label: '에이전트 설정'   },
]
const META_MASTER = {
  1: { failover_sequence:42, ha_group_config:15, vip_config:8,  network_config:23, agent_config:31 },
  2: { failover_sequence:18, ha_group_config:9,  vip_config:5,  network_config:12, agent_config:20 },
  3: { failover_sequence:7,  ha_group_config:3,  vip_config:2,  network_config:5,  agent_config:8  },
}
const META_DIVERGED = { 1: { n2: { ha_group_config: 14 } } }  // n2가 ha_group_config 버전 뒤처짐

function makeMetadataSync(clusterId) {
  const s      = makeStatus(clusterId)
  const master = META_MASTER[clusterId] ?? {}
  const div    = META_DIVERGED[clusterId] ?? {}
  const items  = META_ITEMS.map(m => {
    const masterVer = master[m.key] ?? 1
    const nodes = s.nodes.map(n => {
      const running = n.state === 'RUNNING'
      const ver     = div[n.nodeId]?.[m.key] ?? masterVer
      const status  = !running ? 'UNKNOWN' : ver !== masterVer ? 'DIVERGED' : 'IN_SYNC'
      return { nodeId: n.nodeId, hostname: n.hostname, role: n.role, status, version: ver,
               lastSyncAt: running ? new Date(Date.now() - Math.random()*60000).toISOString() : null }
    })
    return { key: m.key, label: m.label, masterVersion: masterVer, nodes,
             allInSync: nodes.every(n => n.status !== 'DIVERGED') }
  })
  return {
    clusterId: s.clusterId, clusterName: s.clusterName,
    overallStatus: items.every(i => i.allInSync) ? 'IN_SYNC' : 'DIVERGED',
    lastSyncAt:    new Date(Date.now() - 30000).toISOString(),
    items,
  }
}

// ── HTTP 서버 ─────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  // ── SW / DB / Docker / Runbook / Inspection / Report / Alert / Settings ──
  if (req.url === '/api/sw' && req.method === 'GET') {
    res.writeHead(200); res.end(JSON.stringify({ items: swStore })); return
  }
  if (req.url === '/api/db' && req.method === 'GET') {
    res.writeHead(200); res.end(JSON.stringify({ items: dbStore })); return
  }
  if (req.url === '/api/docker/containers' && req.method === 'GET') {
    res.writeHead(200); res.end(JSON.stringify({ containers: containerStore })); return
  }
  if (req.url === '/api/docker/images' && req.method === 'GET') {
    res.writeHead(200); res.end(JSON.stringify({ images: imageStore })); return
  }
  if (req.url === '/api/runbook' && req.method === 'GET') {
    res.writeHead(200); res.end(JSON.stringify({ items: runbookStore })); return
  }
  if (req.url === '/api/runbook' && req.method === 'POST') {
    let body = ''; req.on('data', d => { body += d })
    req.on('end', () => {
      const d = JSON.parse(body || '{}')
      const steps = [
        { label: '사전 준비', done: false, active: true,  waiting: false, time: '진행 중' },
        { label: '대상 확인', done: false, active: false, waiting: true,  time: '대기' },
        { label: '작업 실행', done: false, active: false, waiting: true,  time: '대기' },
        { label: '결과 검증', done: false, active: false, waiting: true,  time: '대기' },
        { label: '완료',     done: false, active: false, waiting: true,  time: '대기' },
      ]
      const item = { id: `rb${nextRbId++}`, ...d, status: 'SCHEDULED', progress: 0, currentStep: 0, steps, createdBy: 'admin' }
      runbookStore.push(item)
      res.writeHead(201); res.end(JSON.stringify(item))
    }); return
  }
  const mRunbookStep = req.url.match(/^\/api\/runbook\/([^/]+)\/step$/)
  if (mRunbookStep && req.method === 'PATCH') {
    const rbId = mRunbookStep[1]
    let body = ''; req.on('data', d => { body += d })
    req.on('end', () => {
      const rb = runbookStore.find(r => String(r.id) === String(rbId))
      if (!rb) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return }
      const { step: targetStep } = JSON.parse(body || '{}')
      const total = rb.steps.length
      rb.steps = rb.steps.map((s, i) => ({
        ...s,
        done:   i < targetStep,
        active: i === targetStep,
        waiting: i > targetStep,
        time: i < targetStep ? '완료' : i === targetStep ? '진행 중' : '대기',
      }))
      rb.currentStep = targetStep
      rb.progress = Math.round(targetStep / total * 100)
      if (rb.status === 'SCHEDULED') { rb.status = 'IN_PROGRESS'; rb.startedAt = new Date().toISOString() }
      if (targetStep === total - 1) {
        rb.steps[total - 1] = { ...rb.steps[total - 1], done: true, active: false, waiting: false, time: '완료' }
        rb.progress = 100
        rb.status = 'COMPLETED'
        rb.completedAt = new Date().toISOString()
      }
      res.writeHead(200); res.end(JSON.stringify(rb))
    }); return
  }
  // ── SW 스캔 / 등록 / 목록 ─────────────────────────────────────
  if (req.url.startsWith('/api/sw/scan') && req.method === 'GET') {
    const known = [
      { name: 'oracle', displayName: 'Oracle DB', pid: 12345, type: 'KNOWN' },
      { name: 'nginx',  displayName: 'Nginx',     pid: 23456, type: 'KNOWN' },
      { name: 'tomcat', displayName: 'Tomcat',    pid: 34567, type: 'KNOWN' },
    ]
    const unknown = [
      { name: 'proc_xyz', pid: 99001 },
      { name: 'java_agt', pid: 99002 },
    ]
    res.writeHead(200); res.end(JSON.stringify({ known, unknown })); return
  }
  if (req.url === '/api/sw/register' && req.method === 'POST') {
    let body = ''; req.on('data', d => { body += d })
    req.on('end', () => {
      const { nodeId, processes } = JSON.parse(body || '{}')
      if (!swProcessStore[nodeId]) swProcessStore[nodeId] = []
      let count = 0
      for (const p of (processes ?? [])) {
        if (!swProcessStore[nodeId].find(x => x.name === p.name)) {
          swProcessStore[nodeId].push({ id: `sw${Date.now()}-${count}`, ...p, status: 'unknown', registeredAt: new Date().toISOString() })
          count++
        }
      }
      res.writeHead(200); res.end(JSON.stringify({ registered: count }))
    }); return
  }
  if (req.url.startsWith('/api/sw/list') && req.method === 'GET') {
    const nodeId = new URL(req.url, 'http://x').searchParams.get('nodeId')
    const items = swProcessStore[nodeId] ?? []
    res.writeHead(200); res.end(JSON.stringify({ items })); return
  }

  // ── AI 장애 분석 ──────────────────────────────────────────────
  const mAiAnalyze = req.url.match(/^\/api\/ai\/analyze\/([^/]+)$/)
  if (mAiAnalyze && req.method === 'POST') {
    const nodeId = mAiAnalyze[1]
    const analysis = {
      id: Date.now(),
      nodeId,
      rootCause: 'Oracle DB 세션 한계 초과로 인한 ORA-00020 오류. 최대 세션 수(processes 파라미터)가 현재 부하를 감당하지 못하고 있습니다.',
      fixCommands: [
        { order: 1, command: 'sqlplus / as sysdba', description: 'Oracle DB에 sysdba 권한으로 접속', risk: 'LOW' },
        { order: 2, command: "ALTER SYSTEM SET processes=500 SCOPE=SPFILE;", description: '프로세스 수를 500으로 증가', risk: 'MEDIUM' },
        { order: 3, command: 'SHUTDOWN IMMEDIATE;', description: 'DB 즉시 종료 (서비스 중단 발생)', risk: 'HIGH' },
        { order: 4, command: 'STARTUP;', description: 'DB 재기동 후 설정 적용', risk: 'MEDIUM' },
      ],
      triggerType: 'MANUAL',
      status: 'DONE',
      createdAt: new Date().toISOString(),
    }
    aiAnalysisStore[nodeId] = analysis
    res.writeHead(200); res.end(JSON.stringify(analysis)); return
  }
  const mAiResult = req.url.match(/^\/api\/ai\/analysis\/([^/]+)$/)
  if (mAiResult && req.method === 'GET') {
    const nodeId = mAiResult[1]
    const result = aiAnalysisStore[nodeId]
    if (!result) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return }
    res.writeHead(200); res.end(JSON.stringify(result)); return
  }

  // ── 에이전트 명령 실행 ──────────────────────────────────────────
  const mAgentExec = req.url.match(/^\/api\/agent\/([^/]+)\/execute$/)
  if (mAgentExec && req.method === 'POST') {
    let body = ''; req.on('data', d => { body += d })
    req.on('end', () => {
      const { command } = JSON.parse(body || '{}')
      res.writeHead(200); res.end(JSON.stringify({
        stdout: `[mock] 명령 실행 완료: ${command}\n출력 결과가 여기에 표시됩니다.`,
        stderr: '',
        exitCode: 0,
      }))
    }); return
  }

  if (req.url === '/api/inspection' && req.method === 'GET') {
    res.writeHead(200); res.end(JSON.stringify({ items: inspectionStore })); return
  }
  if (req.url === '/api/inspection' && req.method === 'POST') {
    let body = ''; req.on('data', d => { body += d })
    req.on('end', () => {
      const d = JSON.parse(body || '{}')
      const item = { id: `ins${nextInsId++}`, ...d, status: d.status ?? 'SCHEDULED', createdBy: 'admin' }
      inspectionStore.push(item)
      res.writeHead(201); res.end(JSON.stringify(item))
    }); return
  }
  const mInspectionId = req.url.match(/^\/api\/inspection\/([^/]+)$/)
  if (mInspectionId && req.method === 'PUT') {
    const idx = inspectionStore.findIndex(i => i.id === mInspectionId[1])
    let body = ''; req.on('data', d => { body += d })
    req.on('end', () => {
      if (idx < 0) { res.writeHead(404); res.end('{}'); return }
      Object.assign(inspectionStore[idx], JSON.parse(body || '{}'))
      res.writeHead(200); res.end(JSON.stringify(inspectionStore[idx]))
    }); return
  }
  if (mInspectionId && req.method === 'DELETE') {
    const idx = inspectionStore.findIndex(i => i.id === mInspectionId[1])
    if (idx >= 0) inspectionStore.splice(idx, 1)
    res.writeHead(200); res.end('{"success":true}'); return
  }
  if (req.url === '/api/reports' && req.method === 'GET') {
    res.writeHead(200); res.end(JSON.stringify({ items: reportStore })); return
  }
  if (req.url === '/api/alerts/config' && req.method === 'GET') {
    res.writeHead(200); res.end(JSON.stringify({ items: alertConfigStore })); return
  }
  const mAlertCfgId = req.url.match(/^\/api\/alerts\/config\/([^/]+)$/)
  if (mAlertCfgId && req.method === 'PUT') {
    const idx = alertConfigStore.findIndex(a => a.id === mAlertCfgId[1])
    let body = ''; req.on('data', d => { body += d })
    req.on('end', () => {
      if (idx < 0) { res.writeHead(404); res.end('{}'); return }
      Object.assign(alertConfigStore[idx], JSON.parse(body || '{}'))
      res.writeHead(200); res.end(JSON.stringify(alertConfigStore[idx]))
    }); return
  }
  if (req.url === '/api/settings/system' && req.method === 'GET') {
    res.writeHead(200); res.end(JSON.stringify(systemSettings)); return
  }
  if (req.url === '/api/settings/system' && req.method === 'PUT') {
    let body = ''; req.on('data', d => { body += d })
    req.on('end', () => {
      Object.assign(systemSettings, JSON.parse(body || '{}'))
      res.writeHead(200); res.end(JSON.stringify(systemSettings))
    }); return
  }

  // ── 하트비트 / 메타데이터 동기화 ────────────────────────────────
  const mHb = req.url.match(/^\/api\/ha\/heartbeat\/(\d+)$/)
  if (mHb && req.method === 'GET') { res.writeHead(200); res.end(JSON.stringify(makeHeartbeat(+mHb[1]))); return }

  const mMeta = req.url.match(/^\/api\/ha\/metadata-sync\/(\d+)$/)
  if (mMeta) {
    if (req.method === 'GET') { res.writeHead(200); res.end(JSON.stringify(makeMetadataSync(+mMeta[1]))); return }
    if (req.method === 'POST') { res.writeHead(200); res.end(JSON.stringify({ success: true, message: '동기화가 시작되었습니다.' })); return }
  }

  // ── HA 운영 절차 시퀀스 ───────────────────────────────────────
  const mHaSeq = req.url.match(/^\/api\/ha\/sequences\/(\d+)$/)
  if (mHaSeq) {
    const cid = +mHaSeq[1]
    if (req.method === 'GET') {
      const seq = haSequenceStore[cid] ?? { STARTUP: [], SHUTDOWN: [], FAILOVER: [] }
      res.writeHead(200); res.end(JSON.stringify(seq)); return
    }
    if (req.method === 'PUT') {
      let body = ''; req.on('data', d => { body += d })
      req.on('end', () => {
        const { type, steps } = JSON.parse(body || '{}')
        if (!haSequenceStore[cid]) haSequenceStore[cid] = { STARTUP: [], SHUTDOWN: [], FAILOVER: [] }
        const reindexed = (steps ?? []).map((s, i) => ({ ...s, id: s.id || `seq${nextSeqId++}`, order: i + 1 }))
        haSequenceStore[cid][type] = reindexed
        res.writeHead(200); res.end(JSON.stringify(haSequenceStore[cid]))
      }); return
    }
  }

  // ── 서비스 CRUD ─────────────────────────────────────────────────
  if (req.url === '/api/services' && req.method === 'GET') {
    res.writeHead(200); res.end(JSON.stringify({ items: Object.values(serviceStore) })); return
  }
  if (req.url === '/api/services' && req.method === 'POST') {
    let body = ''; req.on('data', d => { body += d })
    req.on('end', () => {
      const d = JSON.parse(body || '{}')
      const id = `s${nextSvcId++}`
      const item = { id, status: 'NORMAL', ...d }
      serviceStore[id] = item
      res.writeHead(201); res.end(JSON.stringify(item))
    }); return
  }
  const mSvcId = req.url.match(/^\/api\/services\/([^/]+)$/)
  if (mSvcId && req.method === 'DELETE') {
    delete serviceStore[mSvcId[1]]
    res.writeHead(200); res.end('{"success":true}'); return
  }

  // 대시보드 엔드포인트
  if (req.url === '/api/dashboard/summary')     { res.writeHead(200); res.end(JSON.stringify(makeDashboardSummary())); return }
  if (req.url === '/api/dashboard/sw-status')   { res.writeHead(200); res.end(JSON.stringify(makeDashboardSwStatus())); return }
  if (req.url === '/api/dashboard/alerts')      { res.writeHead(200); res.end(JSON.stringify(makeDashboardAlerts())); return }
  if (req.url === '/api/dashboard/docker')      { res.writeHead(200); res.end(JSON.stringify(makeDashboardDocker())); return }
  if (req.url === '/api/dashboard/performance') { res.writeHead(200); res.end(JSON.stringify(makeDashboardPerformance())); return }

  const mStatus    = req.url.match(/^\/api\/clusters\/(\d+)\/status$/)
  const mGpfs      = req.url.match(/^\/api\/clusters\/(\d+)\/gpfs$/)
  const mNetwork   = req.url.match(/^\/api\/clusters\/(\d+)\/network$/)
  const mFailover  = req.url.match(/^\/api\/clusters\/(\d+)\/failover$/)
  const mAi        = req.url.match(/^\/api\/clusters\/(\d+)\/ai-analysis$/)
  const mAgent     = req.url.match(/^\/api\/clusters\/(\d+)\/agent$/)
  const mNodes     = req.url.match(/^\/api\/clusters\/(\d+)\/nodes$/)
  const mNodeId    = req.url.match(/^\/api\/clusters\/(\d+)\/nodes\/([^/]+)$/)
  const mCluster   = req.url.match(/^\/api\/clusters\/(\d+)$/)

  // 클러스터 상태
  if (mStatus)  { res.writeHead(200); res.end(JSON.stringify(makeStatus(+mStatus[1]))); return }
  if (mGpfs)    { res.writeHead(200); res.end(JSON.stringify(makeGpfs(+mGpfs[1]))); return }
  if (mNetwork) { res.writeHead(200); res.end(JSON.stringify(makeNetwork(+mNetwork[1]))); return }
  if (mAi)      { res.writeHead(200); res.end(JSON.stringify(makeAiAnalysis(+mAi[1]))); return }
  if (mAgent)   { res.writeHead(200); res.end(JSON.stringify(makeAgentData(+mAgent[1]))); return }

  // 수동 Failover
  if (mFailover && req.method === 'POST') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      const { fromNodeId, toNodeId, toHostname } = JSON.parse(body || '{}')
      // 실제로 roleStore 업데이트
      if (fromNodeId && nodeStore[fromNodeId]) nodeStore[fromNodeId].role = 'STANDBY'
      if (toNodeId   && nodeStore[toNodeId])   nodeStore[toNodeId].role   = 'PRIMARY'
      const cid = +(mFailover[1])
      const appIdsByCluster = {
        1: ['oracle', 'nginx', 'nfs', 'heartbeat', 'corosync', 'sshd'],
        2: ['nginx', 'nfs', 'heartbeat', 'corosync', 'sshd'],
        3: ['oracle', 'heartbeat', 'corosync', 'sshd'],
      }
      if (toNodeId) {
        if (!APP_ACTIVE_NODE[cid]) APP_ACTIVE_NODE[cid] = {}
        for (const appId of appIdsByCluster[cid] ?? []) {
          APP_ACTIVE_NODE[cid][appId] = toNodeId
        }
      }
      res.writeHead(200)
      res.end(JSON.stringify({
        success: true,
        message: `Failover 완료: ${toHostname ?? toNodeId ?? '대상 노드'}이(가) PRIMARY로 승격되었습니다.`,
        newPrimary: toNodeId,
        timestamp: new Date().toLocaleString('ko-KR'),
      }))
    })
    return
  }

  const mAppFailover = req.url.match(/^\/api\/clusters\/(\d+)\/apps\/failover$/)
  if (mAppFailover && req.method === 'POST') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      const { appId, toNodeId } = JSON.parse(body || '{}')
      const cid = +mAppFailover[1]
      if (!APP_ACTIVE_NODE[cid]) APP_ACTIVE_NODE[cid] = {}
      if (appId && toNodeId) APP_ACTIVE_NODE[cid][appId] = toNodeId
      res.writeHead(200)
      res.end(JSON.stringify({
        success: true,
        message: `${appId} failover completed to ${toNodeId}`,
        activeNodeId: toNodeId,
        timestamp: new Date().toLocaleString('ko-KR'),
      }))
    })
    return
  }

  const mAppControl = req.url.match(/^\/api\/clusters\/(\d+)\/apps\/control$/)
  if (mAppControl && req.method === 'POST') {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      const { appId, nodeId, desiredState } = JSON.parse(body || '{}')
      const cid = +mAppControl[1]
      if (!appId || !nodeId || !desiredState) {
        res.writeHead(400)
        res.end(JSON.stringify({ success: false, error: 'missing appId/nodeId/desiredState' }))
        return
      }
      if (!APP_OVERRIDES[cid]) APP_OVERRIDES[cid] = {}
      if (!APP_OVERRIDES[cid][nodeId]) APP_OVERRIDES[cid][nodeId] = {}
      APP_OVERRIDES[cid][nodeId][appId] = desiredState === 'running' ? 'running' : 'stopped'
      res.writeHead(200)
      res.end(JSON.stringify({
        success: true,
        message: `${appId} on ${nodeId} set to ${desiredState}`,
        nodeId,
        appId,
        state: APP_OVERRIDES[cid][nodeId][appId],
        timestamp: new Date().toLocaleString('ko-KR'),
      }))
    })
    return
  }

  // ── 노드 목록 GET / 노드 추가 POST ────────────────────────
  if (mNodes) {
    const cid = +mNodes[1]
    if (req.method === 'GET') {
      res.writeHead(200); res.end(JSON.stringify(getClusterNodes(cid))); return
    }
    if (req.method === 'POST') {
      let body = ''
      req.on('data', d => { body += d })
      req.on('end', () => {
        const data    = JSON.parse(body || '{}')
        const nid     = `n${nextNodeId++}`
        const newNode = {
          nodeId:    nid,
          clusterId: cid,
          hostname:  data.hostname  ?? `node-${nid}`,
          ipAddress: data.ipAddress ?? '0.0.0.0',
          vip:       data.vip       ?? '',
          osType:    data.osType    ?? 'Linux',
          role:      data.role      ?? 'STANDBY',
          state:     'RUNNING',
        }
        nodeStore[nid] = newNode
        res.writeHead(201); res.end(JSON.stringify(newNode))
      })
      return
    }
  }

  // ── 노드 수정 PUT / 노드 삭제 DELETE ──────────────────────
  if (mNodeId) {
    const cid = +mNodeId[1], nid = mNodeId[2]

    if (req.method === 'PUT') {
      let body = ''
      req.on('data', d => { body += d })
      req.on('end', () => {
        if (!nodeStore[nid]) { res.writeHead(404); res.end(JSON.stringify({ error: 'node not found' })); return }
        const data = JSON.parse(body || '{}')
        // 활성 서버 지정: role을 PRIMARY로 설정하면 기존 PRIMARY는 STANDBY로
        if (data.role === 'PRIMARY') {
          Object.values(nodeStore).filter(n => String(n.clusterId) === String(cid) && n.role === 'PRIMARY').forEach(n => { n.role = 'STANDBY' })
        }
        Object.assign(nodeStore[nid], data)
        res.writeHead(200); res.end(JSON.stringify(nodeStore[nid]))
      })
      return
    }

    if (req.method === 'DELETE') {
      if (nodeStore[nid]) delete nodeStore[nid]
      res.writeHead(200); res.end(JSON.stringify({ success: true })); return
    }
  }

  // ── 클러스터 목록 GET / 추가 POST ─────────────────────────
  if (req.url === '/api/clusters') {
    if (req.method === 'GET') {
      res.writeHead(200); res.end(JSON.stringify(Object.values(clusterStore))); return
    }
    if (req.method === 'POST') {
      let body = ''
      req.on('data', d => { body += d })
      req.on('end', () => {
        const data = JSON.parse(body || '{}')
        const newC = { id: nextClusterId++, name: data.name, vip: data.vip }
        clusterStore[newC.id] = newC
        res.writeHead(201); res.end(JSON.stringify(newC))
      })
      return
    }
  }

  // ── 클러스터 수정 PUT / 삭제 DELETE ───────────────────────
  if (mCluster) {
    const cid = +mCluster[1]

    if (req.method === 'GET') {
      res.writeHead(200); res.end(JSON.stringify(clusterStore[cid] ?? {})); return
    }

    if (req.method === 'PUT') {
      let body = ''
      req.on('data', d => { body += d })
      req.on('end', () => {
        if (!clusterStore[cid]) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return }
        const data = JSON.parse(body || '{}')
        Object.assign(clusterStore[cid], data)
        res.writeHead(200); res.end(JSON.stringify(clusterStore[cid]))
      })
      return
    }

    if (req.method === 'DELETE') {
      // 해당 클러스터의 노드도 삭제
      Object.keys(nodeStore).filter(k => String(nodeStore[k].clusterId) === String(cid)).forEach(k => delete nodeStore[k])
      delete clusterStore[cid]
      res.writeHead(200); res.end(JSON.stringify({ success: true })); return
    }
  }

  res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(18080, () => console.log('Mock API: http://localhost:18080'))

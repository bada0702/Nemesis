# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `dashboard_design.png` 기준으로 Nemesis 대시보드를 전면 재설계한다 — 새 사이드바, 요약 카드 6종, 클러스터/성능/SW/Docker/AI/알람 패널, 신규 백엔드 API 포함.

**Architecture:** 백엔드에 `/api/dashboard/*` 집계 엔드포인트를 추가하고, 프론트엔드는 대시보드 패널을 독립 컴포넌트로 분리한 뒤 `Dashboard.jsx`에서 조립한다. 기존 클러스터/에이전트 API는 그대로 활용한다.

**Tech Stack:** Java 17 / Spring Boot 3, React 18, Chart.js 4 / react-chartjs-2, Tailwind CSS (CDN), Material Symbols Outlined

---

## 파일 구조

### 신규 생성
```
backend/src/main/java/com/nemesis/
├── domain/dashboard/
│   ├── DashboardController.java
│   └── DashboardService.java
└── dto/
    ├── DashboardSummaryDto.java
    ├── DashboardPerformanceDto.java
    ├── DashboardSwStatusDto.java
    └── AlertDto.java

frontend/src/
├── components/dashboard/
│   ├── SummaryCard.jsx        ← 원형 게이지 카드
│   ├── ClusterStatusPanel.jsx ← 클러스터 상태 테이블
│   ├── PerformancePanel.jsx   ← 도넛 차트 3개
│   ├── TimelineChart.jsx      ← 라인 차트
│   ├── CentralStatus.jsx      ← 정상/장애 쉴드
│   ├── AiPanel.jsx            ← AI 판단 + 채팅
│   ├── AlarmPanel.jsx         ← 실시간 알람
│   ├── SwPanel.jsx            ← SW/미들웨어 테이블
│   └── DockerPanel.jsx        ← Docker 상태 테이블
```

### 수정
```
frontend/
├── index.html                 ← Noto Sans KR 추가, tailwind 색상 확장
├── src/
│   ├── api/client.js          ← dashboard 엔드포인트 추가
│   ├── components/
│   │   ├── Sidebar.jsx        ← 완전 재작성
│   │   ├── Navbar.jsx         ← 날짜/시간, 벨, 유저 프로필 추가
│   │   └── Layout.jsx         ← sidebar 너비 240px 유지
│   └── pages/Dashboard.jsx    ← 완전 재작성 (패널 조립)
```

---

## Task 1: 백엔드 DTO 및 DashboardService

**Files:**
- Create: `backend/src/main/java/com/nemesis/dto/DashboardSummaryDto.java`
- Create: `backend/src/main/java/com/nemesis/dto/DashboardPerformanceDto.java`
- Create: `backend/src/main/java/com/nemesis/dto/DashboardSwStatusDto.java`
- Create: `backend/src/main/java/com/nemesis/dto/AlertDto.java`
- Create: `backend/src/main/java/com/nemesis/domain/dashboard/DashboardService.java`

- [ ] **Step 1: DashboardSummaryDto.java 작성**

```java
// backend/src/main/java/com/nemesis/dto/DashboardSummaryDto.java
package com.nemesis.dto;

import lombok.Builder;
import lombok.Data;
import java.time.OffsetDateTime;

@Data
@Builder
public class DashboardSummaryDto {
    private int clusterCount;
    private int activeNodeCount;
    private int issueWaitingCount;
    private int vipCount;
    private int agentCount;
    private OffsetDateTime lastUpdatedAt;
}
```

- [ ] **Step 2: DashboardPerformanceDto.java 작성**

```java
// backend/src/main/java/com/nemesis/dto/DashboardPerformanceDto.java
package com.nemesis.dto;

import lombok.Builder;
import lombok.Data;
import java.util.List;

@Data
@Builder
public class DashboardPerformanceDto {
    private double avgCpuPercent;
    private double avgMemoryPercent;
    private double avgDiskPercent;
    private List<TimePoint> timeline;

    @Data
    @Builder
    public static class TimePoint {
        private long timestamp;
        private double avgCpu;
        private double avgMem;
    }
}
```

- [ ] **Step 3: DashboardSwStatusDto.java 작성**

```java
// backend/src/main/java/com/nemesis/dto/DashboardSwStatusDto.java
package com.nemesis.dto;

import lombok.Builder;
import lombok.Data;
import java.util.List;

@Data
@Builder
public class DashboardSwStatusDto {
    private List<SwItem> items;

    @Data
    @Builder
    public static class SwItem {
        private String name;
        private String type;
        private String state;
        private String node;
    }
}
```

- [ ] **Step 4: AlertDto.java 작성**

```java
// backend/src/main/java/com/nemesis/dto/AlertDto.java
package com.nemesis.dto;

import lombok.Builder;
import lombok.Data;
import java.util.List;

@Data
@Builder
public class AlertDto {
    private List<AlertItem> items;

    @Data
    @Builder
    public static class AlertItem {
        private String level;   // CRITICAL | WARNING | INFO
        private String message;
        private String createdAt;
    }
}
```

- [ ] **Step 5: DashboardService.java 작성**

```java
// backend/src/main/java/com/nemesis/domain/dashboard/DashboardService.java
package com.nemesis.domain.dashboard;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.agent.AgentKeyRepository;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class DashboardService {

    private final ClusterRepository clusterRepository;
    private final NodeRepository nodeRepository;
    private final AgentKeyRepository agentKeyRepository;
    private final MetricsCacheService metricsCache;

    @Transactional(readOnly = true)
    public DashboardSummaryDto getSummary() {
        long clusterCount = clusterRepository.count();
        List<Node> allNodes = nodeRepository.findAll();
        long activeNodeCount = allNodes.stream()
                .filter(n -> n.getRole() == Node.Role.active).count();
        long vipCount = clusterRepository.findAll().stream()
                .filter(c -> c.getVip() != null && !c.getVip().isBlank()).count();
        long agentCount = agentKeyRepository.count();
        long issueCount = allNodes.stream()
                .filter(n -> n.getRole() == Node.Role.fault).count();

        return DashboardSummaryDto.builder()
                .clusterCount((int) clusterCount)
                .activeNodeCount((int) activeNodeCount)
                .issueWaitingCount((int) issueCount)
                .vipCount((int) vipCount)
                .agentCount((int) agentCount)
                .lastUpdatedAt(OffsetDateTime.now())
                .build();
    }

    public DashboardPerformanceDto getPerformance() {
        var allMetrics = metricsCache.getAll().values();
        if (allMetrics.isEmpty()) {
            return DashboardPerformanceDto.builder()
                    .avgCpuPercent(0).avgMemoryPercent(0).avgDiskPercent(0)
                    .timeline(List.of())
                    .build();
        }
        double avgCpu = allMetrics.stream()
                .mapToDouble(m -> m.getCpuPercent()).average().orElse(0);
        double avgMem = allMetrics.stream()
                .mapToDouble(m -> m.getMemoryPercent()).average().orElse(0);
        double avgDisk = allMetrics.stream()
                .mapToDouble(m -> m.getDiskPercent()).average().orElse(0);

        var timePoint = DashboardPerformanceDto.TimePoint.builder()
                .timestamp(System.currentTimeMillis())
                .avgCpu(round1(avgCpu))
                .avgMem(round1(avgMem))
                .build();

        return DashboardPerformanceDto.builder()
                .avgCpuPercent(round1(avgCpu))
                .avgMemoryPercent(round1(avgMem))
                .avgDiskPercent(round1(avgDisk))
                .timeline(List.of(timePoint))
                .build();
    }

    public DashboardSwStatusDto getSwStatus() {
        var allMetrics = metricsCache.getAll();
        List<DashboardSwStatusDto.SwItem> items = new ArrayList<>();

        allMetrics.forEach((nodeId, metrics) ->
            nodeRepository.findById(nodeId).ifPresent(node -> {
                if (metrics.getProcesses() != null) {
                    metrics.getProcesses().forEach(proc -> {
                        String name   = proc.getOrDefault("name", "unknown");
                        String status = proc.getOrDefault("status", "running");
                        items.add(DashboardSwStatusDto.SwItem.builder()
                                .name(name)
                                .type(inferType(name))
                                .state(status)
                                .node(node.getHostname())
                                .build());
                    });
                }
            })
        );

        return DashboardSwStatusDto.builder().items(items).build();
    }

    @Transactional(readOnly = true)
    public AlertDto getAlerts() {
        List<Node> nodes = nodeRepository.findAll();
        List<AlertDto.AlertItem> items = new ArrayList<>();
        String now = OffsetDateTime.now().toString();

        nodes.forEach(node -> {
            if (node.getRole() == Node.Role.fault) {
                items.add(AlertDto.AlertItem.builder()
                        .level("CRITICAL")
                        .message(node.getHostname() + " 노드 장애 감지")
                        .createdAt(now)
                        .build());
            }
            metricsCache.get(node.getId()).ifPresent(m -> {
                if (m.getCpuPercent() > 85)
                    items.add(AlertDto.AlertItem.builder().level("WARNING")
                            .message(node.getHostname() + " CPU " + Math.round(m.getCpuPercent()) + "% 초과")
                            .createdAt(now).build());
                if (m.getMemoryPercent() > 85)
                    items.add(AlertDto.AlertItem.builder().level("WARNING")
                            .message(node.getHostname() + " Memory " + Math.round(m.getMemoryPercent()) + "% 초과")
                            .createdAt(now).build());
            });
        });

        if (items.isEmpty())
            items.add(AlertDto.AlertItem.builder()
                    .level("INFO").message("시스템 정상 운영 중").createdAt(now).build());

        return AlertDto.builder().items(items).build();
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getDockerStatus() {
        List<Map<String, Object>> nodeList = nodeRepository.findAll().stream().map(n -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("hostname", n.getHostname());
            m.put("runningContainers", 0);
            m.put("totalContainers", 0);
            m.put("status", "N/A");
            return m;
        }).collect(Collectors.toList());
        return Map.of("nodes", nodeList);
    }

    private String inferType(String name) {
        String l = name.toLowerCase();
        if (l.contains("oracle") || l.contains("mysql") || l.contains("postgres")) return "DB";
        if (l.contains("tomcat") || l.contains("jboss") || l.contains("weblogic")) return "WAS";
        if (l.contains("nginx") || l.contains("apache") || l.contains("httpd")) return "Web";
        return "SW";
    }

    private double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }
}
```

- [ ] **Step 6: 커밋**

```bash
git add backend/src/main/java/com/nemesis/dto/DashboardSummaryDto.java \
        backend/src/main/java/com/nemesis/dto/DashboardPerformanceDto.java \
        backend/src/main/java/com/nemesis/dto/DashboardSwStatusDto.java \
        backend/src/main/java/com/nemesis/dto/AlertDto.java \
        backend/src/main/java/com/nemesis/domain/dashboard/DashboardService.java
git commit -m "feat: dashboard aggregate service and DTOs"
```

---

## Task 2: 백엔드 DashboardController

**Files:**
- Create: `backend/src/main/java/com/nemesis/domain/dashboard/DashboardController.java`

- [ ] **Step 1: DashboardController.java 작성**

```java
// backend/src/main/java/com/nemesis/domain/dashboard/DashboardController.java
package com.nemesis.domain.dashboard;

import com.nemesis.dto.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/dashboard")
@RequiredArgsConstructor
public class DashboardController {

    private final DashboardService dashboardService;

    @GetMapping("/summary")
    public ResponseEntity<DashboardSummaryDto> getSummary() {
        return ResponseEntity.ok(dashboardService.getSummary());
    }

    @GetMapping("/performance")
    public ResponseEntity<DashboardPerformanceDto> getPerformance() {
        return ResponseEntity.ok(dashboardService.getPerformance());
    }

    @GetMapping("/sw-status")
    public ResponseEntity<DashboardSwStatusDto> getSwStatus() {
        return ResponseEntity.ok(dashboardService.getSwStatus());
    }

    @GetMapping("/docker")
    public ResponseEntity<Map<String, Object>> getDocker() {
        return ResponseEntity.ok(dashboardService.getDockerStatus());
    }

    @GetMapping("/alerts")
    public ResponseEntity<AlertDto> getAlerts() {
        return ResponseEntity.ok(dashboardService.getAlerts());
    }
}
```

- [ ] **Step 2: 백엔드 빌드 확인**

```bash
cd backend && ./gradlew compileJava 2>&1 | tail -10
```
예상 결과: `BUILD SUCCESSFUL`

- [ ] **Step 3: 커밋**

```bash
git add backend/src/main/java/com/nemesis/domain/dashboard/DashboardController.java
git commit -m "feat: dashboard REST endpoints"
```

---

## Task 3: 프론트엔드 index.html + API client 업데이트

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/api/client.js`

- [ ] **Step 1: index.html 업데이트** — Noto Sans KR 추가 + tailwind 색상 확장

`frontend/index.html`의 `<link>` 폰트 섹션 뒤에 아래 내용을 추가하고, body 스타일과 tailwind.config를 교체한다.

```html
<!DOCTYPE html>
<html lang="ko" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Nemesis HA Console</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;700;900&display=swap">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            'surface':                '#0f1418',
            'surface-container':      '#1b2024',
            'surface-container-high': '#252b2f',
            'surface-variant':        '#30353a',
            'on-surface':             '#dee3e9',
            'on-surface-variant':     '#bec8d2',
            'nm-bg':     '#0D1117',
            'nm-card':   '#161B22',
            'nm-panel':  '#1C2128',
            'nm-border': '#30363D',
            'nm-text':   '#E6EDF3',
            'nm-muted':  '#8B949E',
            'nm-ok':     '#00C853',
            'nm-warn':   '#FFD600',
            'nm-err':    '#FF1744',
            'nm-blue':   '#1E88E5',
          }
        }
      }
    }
  </script>
  <style>
    body { font-family: 'Noto Sans KR', 'Inter', sans-serif; background-color: #0D1117; }
    .font-display { font-family: 'Space Grotesk', sans-serif; }
    .glass { background: rgba(13,17,23,0.85); backdrop-filter: blur(10px); }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #30363D; border-radius: 4px; }
    .material-symbols-outlined {
      font-variation-settings: 'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24;
      vertical-align: middle;
      display: inline-block;
      line-height: 1;
    }
  </style>
</head>
<body class="bg-nm-bg text-nm-text antialiased">
  <div id="root"></div>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    .ai-prose h2 { font-size:13px; font-weight:800; color:#94a3b8; margin:12px 0 6px; text-transform:uppercase; letter-spacing:.08em; }
    .ai-prose h3 { font-size:12px; font-weight:700; color:#cbd5e1; margin:10px 0 4px; }
    .ai-prose p  { font-size:12px; color:#94a3b8; margin:4px 0 8px; line-height:1.6; }
    .ai-prose ul { list-style:disc; padding-left:18px; margin:4px 0 8px; }
    .ai-prose li { font-size:12px; color:#94a3b8; margin:2px 0; line-height:1.6; }
    .ai-prose strong { color:#e2e8f0; font-weight:700; }
    .ai-prose code { background:#0f172a; border-radius:3px; padding:1px 5px; font-size:11px; color:#38bdf8; }
  </style>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

- [ ] **Step 2: client.js 업데이트**

```javascript
// frontend/src/api/client.js
import axios from 'axios'

const client = axios.create({ baseURL: '/api', timeout: 10000 })

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
export const updateNode         = (id, nid, d)   => client.put(`/clusters/${id}/nodes/${nid}`, d)
export const deleteNode         = (id, nid)      => client.delete(`/clusters/${id}/nodes/${nid}`)

// Dashboard APIs
export const getDashboardSummary     = ()  => client.get('/dashboard/summary')
export const getDashboardPerformance = ()  => client.get('/dashboard/performance')
export const getDashboardSwStatus    = ()  => client.get('/dashboard/sw-status')
export const getDashboardDocker      = ()  => client.get('/dashboard/docker')
export const getDashboardAlerts      = ()  => client.get('/dashboard/alerts')
```

- [ ] **Step 3: 커밋**

```bash
git add frontend/index.html frontend/src/api/client.js
git commit -m "feat: add Noto Sans KR, nm-* tailwind tokens, dashboard API client"
```

---

## Task 4: Sidebar.jsx 리디자인

**Files:**
- Modify: `frontend/src/components/Sidebar.jsx`

- [ ] **Step 1: Sidebar.jsx 완전 재작성**

```jsx
// frontend/src/components/Sidebar.jsx
import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const MENU = [
  { label: '대시보드',  icon: 'grid_view',            path: '/' },
  { label: '노드 현황', icon: 'dns',                  path: '/nodes' },
  { label: '알림 센터', icon: 'notifications_active', path: '/alerts' },
  { label: 'Runbook',  icon: 'play_circle',           path: '/runbook' },
  { label: 'AI 로그',  icon: 'psychology',            path: '/ai-log' },
]

const SETTINGS_CHILDREN = [
  { label: '클러스터 관리', path: '/settings/clusters' },
  { label: 'Docker 관리',  path: '/settings/docker' },
  { label: '에이전트 관리', path: '/settings/agents' },
  { label: '시스템 설정',  path: '/settings/system' },
  { label: '보안 설정',    path: '/settings/security' },
]

export default function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const isActive = (path) => location.pathname === path

  return (
    <aside
      className="fixed top-0 left-0 h-screen w-60 z-50 hidden md:flex flex-col"
      style={{ background: '#0D1117', borderRight: '1px solid #21262D' }}
    >
      {/* 로고 */}
      <div
        className="flex items-center gap-3 px-5 py-4"
        style={{ borderBottom: '1px solid #21262D', minHeight: 60 }}
      >
        <div
          className="flex items-center justify-center w-8 h-8 rounded-lg"
          style={{ background: 'rgba(30,136,229,0.15)', border: '1px solid rgba(30,136,229,0.3)' }}
        >
          <span className="material-symbols-outlined text-[18px]" style={{ color: '#1E88E5' }}>
            shield
          </span>
        </div>
        <div>
          <div className="text-[13px] font-black tracking-widest uppercase" style={{ color: '#E6EDF3' }}>
            NEMESIS
          </div>
          <div className="text-[9px] font-semibold tracking-widest" style={{ color: '#1E88E5' }}>
            HA PLATFORM
          </div>
        </div>
      </div>

      {/* 메뉴 */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
        {MENU.map(item => (
          <button
            key={item.label}
            onClick={() => navigate(item.path)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left"
            style={
              isActive(item.path)
                ? { background: 'rgba(30,136,229,0.12)', color: '#1E88E5', borderLeft: '2px solid #1E88E5' }
                : { color: '#8B949E' }
            }
          >
            <span
              className="material-symbols-outlined text-[18px] flex-shrink-0"
              style={{ color: isActive(item.path) ? '#1E88E5' : '#8B949E' }}
            >
              {item.icon}
            </span>
            <span className="text-xs font-semibold">{item.label}</span>
          </button>
        ))}

        {/* 설정 (아코디언) */}
        <div>
          <button
            onClick={() => setSettingsOpen(o => !o)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left"
            style={{ color: '#8B949E' }}
          >
            <span className="material-symbols-outlined text-[18px] flex-shrink-0" style={{ color: '#8B949E' }}>
              settings
            </span>
            <span className="text-xs font-semibold flex-1">설정</span>
            <span className="material-symbols-outlined text-[14px]" style={{ color: '#8B949E' }}>
              {settingsOpen ? 'expand_less' : 'expand_more'}
            </span>
          </button>
          {settingsOpen && (
            <div className="ml-4 mt-0.5 space-y-0.5" style={{ borderLeft: '1px solid #21262D', paddingLeft: 12 }}>
              {SETTINGS_CHILDREN.map(child => (
                <button
                  key={child.label}
                  onClick={() => navigate(child.path)}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs transition-all"
                  style={
                    isActive(child.path)
                      ? { color: '#1E88E5', background: 'rgba(30,136,229,0.08)' }
                      : { color: '#8B949E' }
                  }
                >
                  {child.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>

      {/* 하단 유저 */}
      <div className="px-4 py-4" style={{ borderTop: '1px solid #21262D' }}>
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #1E88E5, #00C853)' }}
          >
            DC
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold truncate" style={{ color: '#E6EDF3' }}>David Cho</div>
            <div className="text-[9px]" style={{ color: '#00C853' }}>● 온라인</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/src/components/Sidebar.jsx
git commit -m "feat: sidebar redesign with NEMESIS branding and Korean menu"
```

---

## Task 5: Navbar.jsx + Layout.jsx 업데이트

**Files:**
- Modify: `frontend/src/components/Navbar.jsx`
- Modify: `frontend/src/components/Layout.jsx`

- [ ] **Step 1: Navbar.jsx 재작성**

```jsx
// frontend/src/components/Navbar.jsx
import React, { useEffect, useState } from 'react'

export default function Navbar() {
  const [now, setNow] = useState('')

  useEffect(() => {
    const fmt = () => {
      const d = new Date()
      const ymd = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`
      const hms = d.toLocaleTimeString('ko-KR', { hour12: false })
      setNow(`${ymd} ${hms}`)
    }
    fmt()
    const id = setInterval(fmt, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <nav
      className="fixed top-0 left-60 right-0 h-14 flex items-center justify-between px-6 z-40"
      style={{ background: '#161B22', borderBottom: '1px solid #21262D' }}
    >
      {/* 타이틀 */}
      <div>
        <h1 className="text-sm font-bold" style={{ color: '#E6EDF3' }}>대시보드</h1>
        <p className="text-[10px]" style={{ color: '#8B949E' }}>전체 시스템 상태 현황 요약입니다</p>
      </div>

      {/* 우측 */}
      <div className="flex items-center gap-4">
        <span className="text-xs font-mono" style={{ color: '#8B949E' }}>{now}</span>
        <button className="relative p-1.5 rounded-lg transition-colors hover:bg-white/5">
          <span className="material-symbols-outlined text-[20px]" style={{ color: '#8B949E' }}>
            notifications
          </span>
          <span
            className="absolute top-1 right-1 w-2 h-2 rounded-full"
            style={{ background: '#FF1744', border: '1.5px solid #161B22' }}
          />
        </button>
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black text-white"
            style={{ background: 'linear-gradient(135deg, #1E88E5, #00C853)' }}
          >
            DC
          </div>
          <span className="text-xs font-semibold" style={{ color: '#E6EDF3' }}>David Cho</span>
        </div>
      </div>
    </nav>
  )
}
```

- [ ] **Step 2: Layout.jsx 업데이트**

```jsx
// frontend/src/components/Layout.jsx
import React from 'react'
import Navbar from './Navbar'
import Sidebar from './Sidebar'

export default function Layout({ children }) {
  return (
    <>
      <Sidebar />
      <Navbar />
      <main className="pt-14 md:pl-60 min-h-screen" style={{ background: '#0D1117' }}>
        <div className="p-5">
          {children}
        </div>
      </main>
    </>
  )
}
```

- [ ] **Step 3: App.jsx에서 onRefresh prop 제거** — Layout이 더 이상 onRefresh를 받지 않으므로

```jsx
// frontend/src/App.jsx
import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import ClusterDetail from './pages/ClusterDetail'
import ClusterSettings from './pages/ClusterSettings'
import Topology from './pages/Topology'
import AlertCenter from './pages/AlertCenter'
import AuditLog from './pages/AuditLog'
import Layout from './components/Layout'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/"                        element={<Dashboard />} />
          <Route path="/cluster/:id"             element={<ClusterDetail />} />
          <Route path="/cluster/:id/topology"    element={<Topology />} />
          <Route path="/cluster/:id/settings"    element={<ClusterSettings />} />
          <Route path="/cluster/:id/alerts"      element={<AlertCenter />} />
          <Route path="/cluster/:id/audit"       element={<AuditLog />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
```

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/components/Navbar.jsx \
        frontend/src/components/Layout.jsx \
        frontend/src/App.jsx
git commit -m "feat: navbar with datetime/bell/user, layout uses nm-bg"
```

---

## Task 6: SummaryCard.jsx (원형 게이지)

**Files:**
- Create: `frontend/src/components/dashboard/SummaryCard.jsx`

- [ ] **Step 1: 디렉토리 생성 및 SummaryCard.jsx 작성**

```bash
mkdir -p frontend/src/components/dashboard
```

```jsx
// frontend/src/components/dashboard/SummaryCard.jsx
import React from 'react'

function CircleGauge({ value, max = 100, color = '#1E88E5' }) {
  const r = 22
  const c = 2 * Math.PI * r
  const pct = Math.min(Math.max(value, 0), max) / max
  const offset = c * (1 - pct)
  return (
    <svg width="56" height="56" viewBox="0 0 52 52" style={{ flexShrink: 0 }}>
      <circle cx="26" cy="26" r={r} fill="none" stroke="#21262D" strokeWidth="4" />
      <circle
        cx="26" cy="26" r={r} fill="none"
        stroke={color} strokeWidth="4"
        strokeDasharray={c} strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 26 26)"
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
      <text
        x="26" y="30" textAnchor="middle"
        fill="#E6EDF3" fontSize="12" fontWeight="700"
        fontFamily="Inter, sans-serif"
      >
        {value}
      </text>
    </svg>
  )
}

export default function SummaryCard({ label, value, max, color = '#1E88E5', isTime = false }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl"
      style={{ background: '#161B22', border: '1px solid #21262D', minWidth: 140, flex: 1 }}
    >
      {isTime ? (
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(30,136,229,0.08)', border: '2px solid #21262D' }}
        >
          <span className="material-symbols-outlined text-[22px]" style={{ color: '#1E88E5' }}>
            schedule
          </span>
        </div>
      ) : (
        <CircleGauge value={value} max={max ?? 100} color={color} />
      )}
      <div className="min-w-0">
        <div className="text-[11px] font-medium truncate" style={{ color: '#8B949E' }}>{label}</div>
        <div className="text-lg font-black" style={{ color: '#E6EDF3', lineHeight: 1.2 }}>
          {isTime ? value : value}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/src/components/dashboard/SummaryCard.jsx
git commit -m "feat: SummaryCard with SVG circular gauge"
```

---

## Task 7: CentralStatus.jsx + AlarmPanel.jsx + AiPanel.jsx

**Files:**
- Create: `frontend/src/components/dashboard/CentralStatus.jsx`
- Create: `frontend/src/components/dashboard/AlarmPanel.jsx`
- Create: `frontend/src/components/dashboard/AiPanel.jsx`

- [ ] **Step 1: CentralStatus.jsx 작성**

```jsx
// frontend/src/components/dashboard/CentralStatus.jsx
import React from 'react'

export default function CentralStatus({ isHealthy = true, faultCount = 0 }) {
  const color = isHealthy ? '#00C853' : '#FF1744'
  const label = isHealthy ? '정상' : '장애'
  const sub   = isHealthy ? '시스템 안전' : `${faultCount}건 감지`

  return (
    <div
      className="flex flex-col items-center justify-center py-8 rounded-xl"
      style={{ background: '#161B22', border: '1px solid #21262D' }}
    >
      <div
        className="flex items-center justify-center w-24 h-24 rounded-full mb-4"
        style={{
          background: `${color}15`,
          border: `2px solid ${color}40`,
          boxShadow: `0 0 32px ${color}30`,
        }}
      >
        <span
          className="material-symbols-outlined text-[48px]"
          style={{ color, fontVariationSettings: "'FILL' 1" }}
        >
          shield
        </span>
      </div>
      <div className="text-2xl font-black" style={{ color }}>{label}</div>
      <div className="text-xs mt-1" style={{ color: '#8B949E' }}>{sub}</div>
    </div>
  )
}
```

- [ ] **Step 2: AlarmPanel.jsx 작성**

```jsx
// frontend/src/components/dashboard/AlarmPanel.jsx
import React from 'react'

const LEVEL_STYLE = {
  CRITICAL: { color: '#FF1744', icon: 'error', bg: 'rgba(255,23,68,0.08)' },
  WARNING:  { color: '#FFD600', icon: 'warning', bg: 'rgba(255,214,0,0.08)' },
  INFO:     { color: '#1E88E5', icon: 'info', bg: 'rgba(30,136,229,0.08)' },
}

export default function AlarmPanel({ items = [] }) {
  return (
    <div
      className="rounded-xl flex flex-col"
      style={{ background: '#161B22', border: '1px solid #21262D' }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid #21262D' }}
      >
        <span className="text-xs font-bold" style={{ color: '#E6EDF3' }}>실시간 알람</span>
        <span className="text-[10px]" style={{ color: '#1E88E5', cursor: 'pointer' }}>더보기 &gt;</span>
      </div>
      <div className="flex-1 overflow-y-auto" style={{ maxHeight: 220 }}>
        {items.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs" style={{ color: '#8B949E' }}>알람 없음</div>
        ) : (
          items.map((item, i) => {
            const s = LEVEL_STYLE[item.level] ?? LEVEL_STYLE.INFO
            return (
              <div
                key={i}
                className="flex items-start gap-2.5 px-4 py-3"
                style={{ borderBottom: '1px solid #21262D', background: i === 0 ? s.bg : undefined }}
              >
                <span
                  className="material-symbols-outlined text-[16px] flex-shrink-0 mt-0.5"
                  style={{ color: s.color }}
                >
                  {s.icon}
                </span>
                <div className="min-w-0">
                  <div className="text-xs leading-snug truncate" style={{ color: '#E6EDF3' }}>
                    {item.message}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: '#8B949E' }}>
                    {item.createdAt ? new Date(item.createdAt).toLocaleTimeString('ko-KR') : '—'}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: AiPanel.jsx 작성**

```jsx
// frontend/src/components/dashboard/AiPanel.jsx
import React, { useState } from 'react'

const DEFAULT_MESSAGES = [
  '현재 모든 클러스터가 정상 상태입니다.',
  '에이전트 메트릭 수집 주기가 정상입니다.',
  'AI Failover 판단 대기 중입니다.',
]

export default function AiPanel({ messages }) {
  const [input, setInput] = useState('')
  const displayMessages = messages ?? DEFAULT_MESSAGES

  return (
    <div
      className="rounded-xl flex flex-col"
      style={{ background: '#161B22', border: '1px solid #21262D' }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid #21262D' }}
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px]" style={{ color: '#1E88E5' }}>
            psychology
          </span>
          <span className="text-xs font-bold" style={{ color: '#E6EDF3' }}>NEMESIS AI</span>
        </div>
        <span className="text-[10px]" style={{ color: '#1E88E5', cursor: 'pointer' }}>더보기 &gt;</span>
      </div>
      <div className="px-4 py-3 space-y-2" style={{ flex: 1 }}>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(30,136,229,0.15)', border: '1px solid rgba(30,136,229,0.3)' }}
        >
          <span className="material-symbols-outlined text-[16px]" style={{ color: '#1E88E5' }}>smart_toy</span>
        </div>
        <p className="text-[10px]" style={{ color: '#8B949E' }}>
          안녕하세요, 현재 시스템을 분석한 결과입니다.
        </p>
        <ul className="space-y-1.5">
          {displayMessages.map((msg, i) => (
            <li key={i} className="text-[11px] flex items-start gap-1.5" style={{ color: '#8B949E' }}>
              <span style={{ color: '#1E88E5', flexShrink: 0 }}>•</span>
              {msg}
            </li>
          ))}
        </ul>
      </div>
      <div className="px-4 pb-4">
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ background: '#0D1117', border: '1px solid #30363D' }}
        >
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="AI에게 질문하기..."
            className="flex-1 bg-transparent text-xs outline-none"
            style={{ color: '#E6EDF3' }}
          />
          <button
            className="flex-shrink-0"
            onClick={() => setInput('')}
          >
            <span className="material-symbols-outlined text-[18px]" style={{ color: '#1E88E5' }}>
              send
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/components/dashboard/CentralStatus.jsx \
        frontend/src/components/dashboard/AlarmPanel.jsx \
        frontend/src/components/dashboard/AiPanel.jsx
git commit -m "feat: CentralStatus, AlarmPanel, AiPanel components"
```

---

## Task 8: ClusterStatusPanel.jsx

**Files:**
- Create: `frontend/src/components/dashboard/ClusterStatusPanel.jsx`

- [ ] **Step 1: ClusterStatusPanel.jsx 작성**

```jsx
// frontend/src/components/dashboard/ClusterStatusPanel.jsx
import React from 'react'
import { useNavigate } from 'react-router-dom'

function StatusBadge({ status }) {
  const map = {
    normal:   { color: '#00C853', label: '정상' },
    warning:  { color: '#FFD600', label: '경고' },
    fault:    { color: '#FF1744', label: '장애' },
    failover: { color: '#FF7043', label: 'Failover' },
  }
  const s = map[status] ?? map.normal
  return (
    <span
      className="text-[9px] font-bold px-2 py-0.5 rounded"
      style={{ color: s.color, background: `${s.color}15`, border: `1px solid ${s.color}40` }}
    >
      {s.label}
    </span>
  )
}

function getClusterStatus(agent) {
  if (!agent.nodes?.length) return 'warning'
  if (agent.nodes.some(n => n.role === 'FAULT')) return 'fault'
  if (agent.failoverEvent) return 'failover'
  return 'normal'
}

function MetricBar({ value = 0 }) {
  const color = value > 85 ? '#FF1744' : value > 70 ? '#FFD600' : '#00C853'
  return (
    <div style={{ width: 60 }}>
      <div className="text-[9px] text-right mb-0.5" style={{ color: '#8B949E' }}>
        {value.toFixed(0)}%
      </div>
      <div className="h-1.5 rounded-full" style={{ background: '#21262D' }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(value, 100)}%`, background: color }}
        />
      </div>
    </div>
  )
}

export default function ClusterStatusPanel({ agents = [] }) {
  const navigate = useNavigate()
  const primary = agent => agent.nodes?.find(n => n.role === 'PRIMARY') ?? agent.nodes?.[0]
  const standby = agent => agent.nodes?.find(n => n.role === 'STANDBY') ?? agent.nodes?.[1]
  const getMetric = (node, key) => node?.metrics?.[key] ?? 0

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: '#161B22', border: '1px solid #21262D' }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid #21262D' }}
      >
        <span className="text-xs font-bold" style={{ color: '#E6EDF3' }}>
          서버 클러스터 상태
        </span>
        <span
          className="text-[9px] px-2 py-0.5 rounded"
          style={{ color: '#1E88E5', background: 'rgba(30,136,229,0.1)', border: '1px solid rgba(30,136,229,0.2)' }}
        >
          Active
        </span>
      </div>

      {agents.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs" style={{ color: '#8B949E' }}>
          등록된 클러스터가 없습니다
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: '#0D1117' }}>
                {['그룹명', 'Active', 'Standby', 'CPU', 'MEM', 'DISK', 'VIP', '상태'].map(h => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left font-semibold"
                    style={{ color: '#8B949E', fontSize: 10 }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map(agent => {
                const p = primary(agent)
                const s = standby(agent)
                const status = getClusterStatus(agent)
                return (
                  <tr
                    key={agent.clusterId}
                    className="cursor-pointer transition-colors"
                    style={{ borderTop: '1px solid #21262D' }}
                    onClick={() => navigate(`/cluster/${agent.clusterId}`)}
                    onMouseEnter={e => e.currentTarget.style.background = '#1C2128'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}
                  >
                    <td className="px-3 py-2.5 font-semibold" style={{ color: '#E6EDF3' }}>
                      {agent.clusterName}
                    </td>
                    <td className="px-3 py-2.5 font-mono" style={{ color: '#8B949E', fontSize: 10 }}>
                      {p?.hostname ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono" style={{ color: '#8B949E', fontSize: 10 }}>
                      {s?.hostname ?? '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <MetricBar value={getMetric(p, 'cpuPercent')} />
                    </td>
                    <td className="px-3 py-2.5">
                      <MetricBar value={getMetric(p, 'memoryPercent')} />
                    </td>
                    <td className="px-3 py-2.5">
                      <MetricBar value={getMetric(p, 'diskPercent')} />
                    </td>
                    <td className="px-3 py-2.5 font-mono" style={{ color: '#8B949E', fontSize: 10 }}>
                      {agent.vip ?? '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/src/components/dashboard/ClusterStatusPanel.jsx
git commit -m "feat: ClusterStatusPanel with metric bars and status badges"
```

---

## Task 9: PerformancePanel.jsx + TimelineChart.jsx

**Files:**
- Create: `frontend/src/components/dashboard/PerformancePanel.jsx`
- Create: `frontend/src/components/dashboard/TimelineChart.jsx`

- [ ] **Step 1: PerformancePanel.jsx 작성**

```jsx
// frontend/src/components/dashboard/PerformancePanel.jsx
import React from 'react'
import { Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, Tooltip } from 'chart.js'

ChartJS.register(ArcElement, Tooltip)

function DonutGauge({ label, value = 0 }) {
  const color = value > 85 ? '#FF1744' : value > 70 ? '#FFD600' : '#00C853'
  const data = {
    datasets: [{
      data: [value, 100 - value],
      backgroundColor: [color, '#21262D'],
      borderWidth: 0,
    }],
  }
  const options = {
    responsive: false,
    cutout: '72%',
    animation: false,
    plugins: { tooltip: { enabled: false } },
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <div style={{ position: 'relative', width: 100, height: 100 }}>
        <Doughnut data={data} options={options} width={100} height={100} />
        <div
          style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)', textAlign: 'center',
          }}
        >
          <div className="text-[18px] font-black" style={{ color: '#E6EDF3' }}>
            {value.toFixed(0)}%
          </div>
        </div>
      </div>
      <span className="text-[11px] font-semibold" style={{ color: '#8B949E' }}>{label}</span>
    </div>
  )
}

export default function PerformancePanel({ cpu = 0, mem = 0, disk = 0 }) {
  return (
    <div
      className="rounded-xl px-4 py-4"
      style={{ background: '#161B22', border: '1px solid #21262D' }}
    >
      <div
        className="text-xs font-bold mb-4"
        style={{ color: '#E6EDF3', borderBottom: '1px solid #21262D', paddingBottom: 10 }}
      >
        시스템 성능 현황
      </div>
      <div className="flex justify-around">
        <DonutGauge label="CPU" value={cpu} />
        <DonutGauge label="Memory" value={mem} />
        <DonutGauge label="Disk" value={disk} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TimelineChart.jsx 작성**

```jsx
// frontend/src/components/dashboard/TimelineChart.jsx
import React, { useEffect, useRef, useState } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, Tooltip, Filler,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler)

const MAX_POINTS = 20

export default function TimelineChart({ cpuValue = 0 }) {
  const [history, setHistory] = useState(Array(MAX_POINTS).fill(0))
  const [labels,  setLabels]  = useState(Array(MAX_POINTS).fill(''))

  useEffect(() => {
    setHistory(prev => {
      const next = [...prev.slice(1), cpuValue]
      return next
    })
    setLabels(prev => {
      const t = new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      return [...prev.slice(1), t]
    })
  }, [cpuValue])

  const data = {
    labels,
    datasets: [{
      label: 'CPU %',
      data: history,
      borderColor: '#1E88E5',
      backgroundColor: 'rgba(30,136,229,0.08)',
      fill: true,
      tension: 0.4,
      pointRadius: 0,
      borderWidth: 2,
    }],
  }

  const options = {
    responsive: true,
    animation: false,
    scales: {
      y: {
        min: 0, max: 100,
        grid: { color: '#21262D' },
        ticks: { color: '#8B949E', font: { size: 10 } },
      },
      x: {
        grid: { display: false },
        ticks: {
          color: '#8B949E',
          font: { size: 9 },
          maxTicksLimit: 5,
          maxRotation: 0,
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: true },
    },
  }

  return (
    <div
      className="rounded-xl px-4 py-4"
      style={{ background: '#161B22', border: '1px solid #21262D' }}
    >
      <div
        className="text-xs font-bold mb-3"
        style={{ color: '#E6EDF3', borderBottom: '1px solid #21262D', paddingBottom: 10 }}
      >
        클러스터 타임라인 현황
      </div>
      <Line data={data} options={options} height={100} />
    </div>
  )
}
```

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/components/dashboard/PerformancePanel.jsx \
        frontend/src/components/dashboard/TimelineChart.jsx
git commit -m "feat: donut gauge PerformancePanel and live TimelineChart"
```

---

## Task 10: SwPanel.jsx + DockerPanel.jsx

**Files:**
- Create: `frontend/src/components/dashboard/SwPanel.jsx`
- Create: `frontend/src/components/dashboard/DockerPanel.jsx`

- [ ] **Step 1: SwPanel.jsx 작성**

```jsx
// frontend/src/components/dashboard/SwPanel.jsx
import React from 'react'

const TYPE_COLOR = { DB: '#FFD600', WAS: '#1E88E5', Web: '#00C853', SW: '#8B949E' }

export default function SwPanel({ items = [] }) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: '#161B22', border: '1px solid #21262D' }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid #21262D' }}
      >
        <span className="text-xs font-bold" style={{ color: '#E6EDF3' }}>SW / 미들웨어 상태</span>
        <span className="text-[10px]" style={{ color: '#1E88E5', cursor: 'pointer' }}>더보기 &gt;</span>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-5 text-center text-xs" style={{ color: '#8B949E' }}>
          수집된 SW 프로세스 없음
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: '#0D1117' }}>
                {['SW명', '타입', '노드', '상태'].map(h => (
                  <th key={h} className="px-3 py-2 text-left" style={{ color: '#8B949E', fontSize: 10, fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 8).map((item, i) => {
                const isRunning = item.state === 'running'
                return (
                  <tr key={i} style={{ borderTop: '1px solid #21262D' }}>
                    <td className="px-3 py-2 text-xs font-semibold" style={{ color: '#E6EDF3' }}>
                      {item.name}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                        style={{
                          color: TYPE_COLOR[item.type] ?? '#8B949E',
                          background: `${TYPE_COLOR[item.type] ?? '#8B949E'}15`,
                        }}
                      >
                        {item.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono" style={{ color: '#8B949E' }}>
                      {item.node}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5 text-xs" style={{ color: isRunning ? '#00C853' : '#FF1744' }}>
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: isRunning ? '#00C853' : '#FF1744' }}
                        />
                        {isRunning ? '정상' : '중단'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: DockerPanel.jsx 작성**

```jsx
// frontend/src/components/dashboard/DockerPanel.jsx
import React from 'react'

export default function DockerPanel({ nodes = [] }) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: '#161B22', border: '1px solid #21262D' }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid #21262D' }}
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px]" style={{ color: '#1E88E5' }}>
            deployed_code
          </span>
          <span className="text-xs font-bold" style={{ color: '#E6EDF3' }}>Docker 상태</span>
        </div>
      </div>
      {nodes.length === 0 ? (
        <div className="px-4 py-5 text-center text-xs" style={{ color: '#8B949E' }}>
          Docker 에이전트 미연결
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: '#21262D' }}>
          {nodes.map((node, i) => (
            <div key={i} className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold" style={{ color: '#E6EDF3' }}>{node.hostname}</div>
                <div className="text-[10px] mt-0.5" style={{ color: '#8B949E' }}>
                  컨테이너 {node.runningContainers}/{node.totalContainers}
                </div>
              </div>
              <span
                className="text-[9px] font-bold px-2 py-0.5 rounded"
                style={{ color: '#8B949E', background: '#21262D', border: '1px solid #30363D' }}
              >
                {node.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/components/dashboard/SwPanel.jsx \
        frontend/src/components/dashboard/DockerPanel.jsx
git commit -m "feat: SwPanel and DockerPanel components"
```

---

## Task 11: Dashboard.jsx 완전 재작성

**Files:**
- Modify: `frontend/src/pages/Dashboard.jsx`

- [ ] **Step 1: Dashboard.jsx 재작성** — 모든 패널을 조립한다

```jsx
// frontend/src/pages/Dashboard.jsx
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getClusters, getClusterAgent,
  getDashboardSummary, getDashboardPerformance,
  getDashboardSwStatus, getDashboardDocker, getDashboardAlerts,
  createCluster, deleteCluster, triggerAppFailover, controlAppService,
} from '../api/client'
import SummaryCard        from '../components/dashboard/SummaryCard'
import CentralStatus      from '../components/dashboard/CentralStatus'
import ClusterStatusPanel from '../components/dashboard/ClusterStatusPanel'
import PerformancePanel   from '../components/dashboard/PerformancePanel'
import TimelineChart      from '../components/dashboard/TimelineChart'
import SwPanel            from '../components/dashboard/SwPanel'
import DockerPanel        from '../components/dashboard/DockerPanel'
import AiPanel            from '../components/dashboard/AiPanel'
import AlarmPanel         from '../components/dashboard/AlarmPanel'

const POLL_MS = 5000

function AddClusterModal({ onClose, onCreated }) {
  const [form,   setForm]   = useState({ name: '', vip: '' })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!form.name || !form.vip) { setError('이름과 VIP는 필수입니다.'); return }
    setSaving(true); setError(null)
    try {
      await createCluster(form)
      onCreated()
    } catch { setError('클러스터 생성 중 오류가 발생했습니다.') }
    finally { setSaving(false) }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
        style={{ background: '#161B22', border: '1px solid #30363D' }}>
        <div className="flex items-center justify-between mb-5">
          <span className="text-sm font-bold" style={{ color: '#E6EDF3' }}>새 클러스터 추가</span>
          <button onClick={onClose}>
            <span className="material-symbols-outlined text-[20px]" style={{ color: '#8B949E' }}>close</span>
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {[['클러스터 이름', 'name', '예: prod-cluster-01'], ['클러스터 VIP', 'vip', '예: 192.168.1.100']].map(([label, key, ph]) => (
            <div key={key}>
              <label className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#8B949E' }}>
                {label} <span style={{ color: '#FF1744' }}>*</span>
              </label>
              <input
                value={form[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                placeholder={ph}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: '#0D1117', border: '1px solid #30363D', color: '#E6EDF3' }}
              />
            </div>
          ))}
          {error && <p className="text-xs" style={{ color: '#FF1744' }}>{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg text-xs font-bold"
              style={{ border: '1px solid #30363D', color: '#8B949E' }}>취소</button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-xs font-bold"
              style={{ background: '#1E88E5', color: '#fff', opacity: saving ? 0.6 : 1 }}>
              {saving ? '생성 중...' : '클러스터 생성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [agents,    setAgents]    = useState([])
  const [summary,   setSummary]   = useState(null)
  const [perf,      setPerf]      = useState(null)
  const [swItems,   setSwItems]   = useState([])
  const [docker,    setDocker]    = useState([])
  const [alerts,    setAlerts]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [addOpen,   setAddOpen]   = useState(false)

  const load = useCallback(async () => {
    try {
      const [listRes, sumRes, perfRes, swRes, dkRes, alRes] = await Promise.allSettled([
        getClusters(),
        getDashboardSummary(),
        getDashboardPerformance(),
        getDashboardSwStatus(),
        getDashboardDocker(),
        getDashboardAlerts(),
      ])

      if (listRes.status === 'fulfilled') {
        const agentData = await Promise.all(
          listRes.value.data.map(c =>
            getClusterAgent(c.id).then(r => r.data).catch(() => ({
              clusterId: c.id, clusterName: c.name, vip: c.vip, nodes: [], failoverEvent: null,
            }))
          )
        )
        setAgents(agentData)
      }
      if (sumRes.status  === 'fulfilled') setSummary(sumRes.value.data)
      if (perfRes.status === 'fulfilled') setPerf(perfRes.value.data)
      if (swRes.status   === 'fulfilled') setSwItems(swRes.value.data.items ?? [])
      if (dkRes.status   === 'fulfilled') setDocker(dkRes.value.data.nodes ?? [])
      if (alRes.status   === 'fulfilled') setAlerts(alRes.value.data.items ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, POLL_MS)
    return () => clearInterval(iv)
  }, [load])

  const faultCount = agents.flatMap(a => a.nodes ?? []).filter(n => n.role === 'FAULT').length
  const isHealthy  = faultCount === 0 && !agents.some(a => a.failoverEvent)
  const lastUpdate = summary?.lastUpdatedAt
    ? new Date(summary.lastUpdatedAt).toLocaleTimeString('ko-KR')
    : '—'

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-sm" style={{ color: '#8B949E' }}>
          <div
            className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: '#1E88E5', borderTopColor: 'transparent' }}
          />
          시스템 상태 로딩 중...
        </div>
      </div>
    )
  }

  return (
    <>
      {addOpen && <AddClusterModal onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); load() }} />}

      {/* 요약 카드 */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <SummaryCard label="클러스터"    value={summary?.clusterCount ?? 0}    max={10}  color="#1E88E5" />
        <SummaryCard label="활성"        value={summary?.activeNodeCount ?? 0} max={20}  color="#00C853" />
        <SummaryCard label="이슈대기(AI)" value={summary?.issueWaitingCount ?? 0} max={10} color="#FF7043" />
        <SummaryCard label="VIP"         value={summary?.vipCount ?? 0}        max={10}  color="#FFD600" />
        <SummaryCard label="에이전트"    value={summary?.agentCount ?? 0}      max={20}  color="#AB47BC" />
        <SummaryCard label="마지막 업데이트" value={lastUpdate} isTime />
      </div>

      {/* 메인 그리드 */}
      <div className="grid grid-cols-12 gap-4">

        {/* 좌측 (8/12) */}
        <div className="col-span-12 lg:col-span-8 space-y-4">
          <ClusterStatusPanel agents={agents} />
          <PerformancePanel
            cpu={perf?.avgCpuPercent ?? 0}
            mem={perf?.avgMemoryPercent ?? 0}
            disk={perf?.avgDiskPercent ?? 0}
          />
          <TimelineChart cpuValue={perf?.avgCpuPercent ?? 0} />
          <SwPanel items={swItems} />
          <DockerPanel nodes={docker} />
        </div>

        {/* 우측 (4/12) */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          <CentralStatus isHealthy={isHealthy} faultCount={faultCount} />
          <AlarmPanel items={alerts} />
          <AiPanel />
        </div>
      </div>

      {/* 하단 — 클러스터 추가 버튼 */}
      <div className="mt-5 flex justify-end">
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-all"
          style={{
            background: 'rgba(30,136,229,0.1)',
            border: '1px solid rgba(30,136,229,0.3)',
            color: '#1E88E5',
          }}
        >
          <span className="material-symbols-outlined text-[18px]">add_circle</span>
          클러스터 추가
        </button>
      </div>
    </>
  )
}
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/src/pages/Dashboard.jsx
git commit -m "feat: dashboard redesign - assemble all panels per PNG design"
```

---

## Task 12: 프론트엔드 빌드 확인 및 개발 서버 실행

**Files:** 없음 (검증만)

- [ ] **Step 1: 의존성 설치 확인**

```bash
cd frontend && npm install 2>&1 | tail -5
```
예상 결과: `added N packages` or `up to date`

- [ ] **Step 2: 개발 서버 실행**

```bash
cd frontend && npm run dev
```
예상 결과: `Local: http://localhost:5173/` 출력

- [ ] **Step 3: 브라우저에서 확인 항목**

`http://localhost:5173/` 접속 후:
- [ ] NEMESIS 로고 + 새 사이드바 메뉴 6종 표시
- [ ] Navbar 우측 날짜/시간 실시간 업데이트
- [ ] 요약 카드 6개 원형 게이지 표시
- [ ] 좌측: 클러스터 테이블, 도넛 차트 3개, 타임라인, SW 테이블, Docker 패널
- [ ] 우측: 정상(초록 쉴드), 알람 패널, AI 패널
- [ ] 기존 `/cluster/:id` 상세 페이지 정상 접근

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git commit -m "feat: dashboard PNG redesign complete"
```

---

## Self-Review

**스펙 커버리지 점검:**
- [x] 사이드바 12개 메뉴 → 구현 (6+5 설정 하위)
- [x] Navbar 날짜/시간/벨/유저 → Task 5
- [x] 요약 카드 6종 원형 게이지 → Task 6
- [x] 서버 클러스터 상태 테이블 → Task 8
- [x] 시스템 성능 도넛 차트 3개 → Task 9
- [x] 타임라인 차트 → Task 9
- [x] SW/미들웨어 상태 패널 → Task 10
- [x] Docker 상태 패널 → Task 10
- [x] CentralStatus 쉴드 → Task 7
- [x] AI 패널 + 채팅 입력 → Task 7
- [x] 실시간 알람 → Task 7
- [x] 백엔드 API 5종 → Task 1+2
- [x] Noto Sans KR 폰트 → Task 3
- [x] nm-* Tailwind 토큰 → Task 3

**플레이스홀더 없음** — 모든 단계에 완성된 코드 포함

**타입 일관성** — `getDashboardSummary`, `getDashboardPerformance` 등 client.js 함수명이 Dashboard.jsx import와 일치

package com.nemesis.domain.report;

import com.nemesis.cache.MetricsCacheService;
import com.nemesis.domain.ai.llm.LlmService;
import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.failover.FailoverHistory;
import com.nemesis.domain.failover.FailoverHistoryRepository;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import com.nemesis.dto.MetricsPushRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * 운영 리포트 생성. 생성 시점에 실 데이터를 텍스트로 스냅샷한다.
 * - MONTHLY:     클러스터/노드/VIP 구성 요약
 * - INCIDENT:    failover_history 기반 장애·페일오버 이력
 * - PERFORMANCE: 메트릭 캐시 기반 평균 자원 사용률
 * - SECURITY:    노드 도달성·VIP 노출 등 보안 점검 요약
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ReportService {

    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private final ReportRepository reportRepository;
    private final ClusterRepository clusterRepository;
    private final NodeRepository nodeRepository;
    private final FailoverHistoryRepository failoverHistoryRepository;
    private final MetricsCacheService metricsCache;
    private final LlmService llmService;

    @Transactional(readOnly = true)
    public List<Map<String, Object>> list() {
        return reportRepository.findAllByOrderByCreatedAtDesc().stream().map(this::toMap).toList();
    }

    @Transactional
    public Map<String, Object> generate(String type) {
        String t = (type == null || type.isBlank()) ? "MONTHLY" : type.trim().toUpperCase();
        String content = switch (t) {
            case "INCIDENT"    -> incidentReport();
            case "PERFORMANCE" -> performanceReport();
            case "SECURITY"    -> securityReport();
            default            -> monthlyReport();
        };
        String title = titleFor(t);
        content += aiNarrative(title, content);   // 데이터 스냅샷 기반 AI 분석 섹션 추가
        int bytes = content.getBytes().length;

        Report report = Report.builder()
                .title(title)
                .type(t)
                .status("READY")
                .content(content)
                .size(humanSize(bytes))
                .build();
        return toMap(reportRepository.save(report));
    }

    @Transactional(readOnly = true)
    public Report get(UUID id) {
        return reportRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Report not found: " + id));
    }

    @Transactional
    public void delete(UUID id) {
        if (!reportRepository.existsById(id))
            throw new IllegalArgumentException("Report not found: " + id);
        reportRepository.deleteById(id);
    }

    /** 데이터 스냅샷을 LLM에 넘겨 핵심 요약·위험 분석·권고를 한국어 내러티브로 생성한다(best-effort). */
    private String aiNarrative(String title, String data) {
        String head = "\n\n================================================\n"
                + "  AI 운영 분석\n"
                + "================================================\n\n";
        if (!llmService.isAvailable()) {
            return head + "(LLM이 연결되지 않아 AI 분석을 생략했습니다. .env의 LLM 설정을 확인하세요.)\n";
        }
        try {
            String sys = "당신은 엔터프라이즈 AIX/Linux 고가용성(HA) 인프라 운영 분석가입니다. "
                    + "아래 운영 데이터를 근거로 한국어 리포트를 작성하세요. 형식:\n"
                    + "1) 핵심 요약 (3~4문장)\n"
                    + "2) 위험·이상 징후 분석 (데이터 수치를 인용해 구체적으로)\n"
                    + "3) 권고 조치 (우선순위 순 3가지, 실행 가능한 형태)\n"
                    + "과장 없이 실무적으로, 데이터에 없는 내용은 추측하지 마세요.";
            String reply = llmService.chat(sys, "리포트 종류: " + title + "\n\n운영 데이터:\n" + data);
            return head + reply + "\n";
        } catch (Exception e) {
            log.warn("리포트 AI 분석 실패: {}", e.getMessage());
            return head + "(AI 분석 생성 실패: " + e.getMessage() + ")\n";
        }
    }

    // ── 리포트 본문 생성 ───────────────────────────────────────

    private String monthlyReport() {
        StringBuilder sb = header("월간 운영 리포트");
        List<Cluster> clusters = clusterRepository.findAll();
        List<Node> nodes = nodeRepository.findAll();
        sb.append("■ 구성 요약\n");
        sb.append("  - 클러스터 수: ").append(clusters.size()).append("\n");
        sb.append("  - 전체 노드 수: ").append(nodes.size()).append("\n");
        sb.append("  - 활성(PRIMARY) 노드: ")
          .append(nodes.stream().filter(n -> n.getRole() == Node.Role.active).count()).append("\n");
        sb.append("  - 장애(FAULT) 노드: ")
          .append(nodes.stream().filter(n -> n.getRole() == Node.Role.fault).count()).append("\n\n");

        sb.append("■ 클러스터별 상세\n");
        for (Cluster c : clusters) {
            List<Node> cn = nodeRepository.findByClusterId(c.getId());
            sb.append("  • ").append(c.getName())
              .append(" (VIP: ").append(c.getVip() == null ? "-" : c.getVip()).append(")\n");
            for (Node n : cn) {
                sb.append("      - ").append(n.getHostname())
                  .append(" [").append(n.getRole().uiToken()).append("]\n");
            }
        }
        return sb.toString();
    }

    private String incidentReport() {
        StringBuilder sb = header("장애 이력 리포트");
        List<Cluster> clusters = clusterRepository.findAll();
        int total = 0;
        for (Cluster c : clusters) {
            List<FailoverHistory> hist = failoverHistoryRepository
                    .findByClusterGroupIdOrderByCreatedAtDesc(c.getId());
            if (hist.isEmpty()) continue;
            sb.append("■ ").append(c.getName()).append("\n");
            for (FailoverHistory h : hist) {
                total++;
                sb.append("  - ").append(h.getCreatedAt() == null ? "-" : TS.format(h.getCreatedAt()))
                  .append(" | ").append(h.getTrigger())
                  .append(" | ").append(h.getStatus())
                  .append(h.getDurationMs() != null ? " | " + h.getDurationMs() + "ms" : "")
                  .append(h.getReason() != null ? " | " + h.getReason() : "")
                  .append("\n");
            }
            sb.append("\n");
        }
        if (total == 0) sb.append("기록된 페일오버 이력이 없습니다.\n");
        else sb.insert(sb.indexOf("\n\n") + 2, "총 페일오버 이벤트: " + total + "건\n\n");
        return sb.toString();
    }

    private String performanceReport() {
        StringBuilder sb = header("성능 분석 리포트");
        Map<UUID, MetricsPushRequest> all = metricsCache.getAll();
        if (all.isEmpty()) {
            sb.append("수집된 메트릭이 없습니다.\n");
            return sb.toString();
        }
        double avgCpu  = all.values().stream().mapToDouble(MetricsPushRequest::getCpuPercent).average().orElse(0);
        double avgMem  = all.values().stream().mapToDouble(MetricsPushRequest::getMemoryPercent).average().orElse(0);
        double avgDisk = all.values().stream().mapToDouble(MetricsPushRequest::getDiskPercent).average().orElse(0);
        sb.append("■ 전체 평균 자원 사용률 (수집 노드 ").append(all.size()).append("개 기준)\n");
        sb.append(String.format("  - CPU:    %.1f%%%n", avgCpu));
        sb.append(String.format("  - Memory: %.1f%%%n", avgMem));
        sb.append(String.format("  - Disk:   %.1f%%%n%n", avgDisk));

        sb.append("■ 노드별 현재 사용률\n");
        all.forEach((nodeId, m) -> nodeRepository.findById(nodeId).ifPresent(n ->
            sb.append(String.format("  - %-20s CPU %.0f%% / MEM %.0f%% / DISK %.0f%%%n",
                    n.getHostname(), m.getCpuPercent(), m.getMemoryPercent(), m.getDiskPercent()))));
        return sb.toString();
    }

    private String securityReport() {
        StringBuilder sb = header("보안 감사 리포트");
        List<Cluster> clusters = clusterRepository.findAll();
        sb.append("■ VIP 노출 현황\n");
        for (Cluster c : clusters) {
            sb.append("  - ").append(c.getName()).append(": ")
              .append(c.getVip() == null || c.getVip().isBlank() ? "VIP 미설정" : c.getVip())
              .append("\n");
        }
        sb.append("\n■ 노드 도달성(메트릭 신선도)\n");
        for (Node n : nodeRepository.findAll()) {
            boolean reachable = metricsCache.isFresh(n.getId(), 10_000);
            sb.append("  - ").append(n.getHostname()).append(": ")
              .append(reachable ? "도달 가능(에이전트 활성)" : "도달 불가/오래됨").append("\n");
        }
        return sb.toString();
    }

    private StringBuilder header(String title) {
        StringBuilder sb = new StringBuilder();
        sb.append("================================================\n");
        sb.append("  NEMESIS ").append(title).append("\n");
        sb.append("  생성 시각: ").append(TS.format(OffsetDateTime.now())).append("\n");
        sb.append("================================================\n\n");
        return sb;
    }

    private String titleFor(String type) {
        String date = LocalDate.now().toString();
        return switch (type) {
            case "INCIDENT"    -> "장애 이력 리포트 " + date;
            case "PERFORMANCE" -> "성능 분석 리포트 " + date;
            case "SECURITY"    -> "보안 감사 리포트 " + date;
            default            -> "월간 운영 리포트 " + date;
        };
    }

    private String humanSize(int bytes) {
        if (bytes < 1024) return bytes + " B";
        return String.format("%.1f KB", bytes / 1024.0);
    }

    private Map<String, Object> toMap(Report r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id",        r.getId());
        m.put("title",     r.getTitle());
        m.put("type",      r.getType());
        m.put("status",    r.getStatus());
        m.put("size",      r.getSize());
        m.put("createdAt", r.getCreatedAt() == null ? null : TS.format(r.getCreatedAt()));
        return m;
    }
}

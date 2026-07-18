package com.nemesis.domain.aiops.monitor;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.aiops.AiOperatorService;
import com.nemesis.domain.aiops.AiProposal;
import com.nemesis.domain.aiops.dto.AiOpsDtos.ScanFinding;
import com.nemesis.domain.aiops.dto.AiOpsDtos.Suspect;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.*;

/** SP3: finding 상태추적(open/resolved) + 심각건 제안 연결. */
@Slf4j
@Service
public class AiFindingService {
    private final AiFindingRepository repo;
    private final AiOperatorService ops;
    private final ObjectMapper mapper;
    private final com.nemesis.domain.ai.llm.LlmService llm;

    public AiFindingService(AiFindingRepository repo, AiOperatorService ops, ObjectMapper mapper,
                            com.nemesis.domain.ai.llm.LlmService llm) {
        this.repo = repo; this.ops = ops; this.mapper = mapper; this.llm = llm;
    }

    @Transactional
    public void recordWarn(Suspect s) { recordWarn(s, AiFinding.REACTIVE); }

    @Transactional
    public void recordWarn(Suspect s, String category) {
        String fp = AiFinding.fingerprint(s.nodeId(), s.signalType());
        Optional<AiFinding> open = repo.findByFingerprintAndStatus(fp, AiFinding.OPEN);
        if (open.isPresent()) {                 // 기존 열림 → lastSeen만 갱신(LLM 재호출 안 함: 비용 한정)
            AiFinding f = open.get();
            f.setLastSeenAt(OffsetDateTime.now());
            f.setSummary(summary(s));
            repo.save(f);
            return;
        }
        if (refreshIgnored(fp)) return;         // 사용자가 무시한 신호 → 다시 띄우지 않음
        AiFinding f = newFinding(s, category);
        f.setSummary(summary(s));
        explainErrorPattern(s, f);              // 신규일 때만 SSH 없는 경량 LLM 설명
        repo.save(f);
    }

    /** 무시된 동일 지문이 있으면 lastSeen만 갱신하고 true. 무시를 sticky하게 유지. */
    private boolean refreshIgnored(String fp) {
        Optional<AiFinding> ig = repo.findByFingerprintAndStatus(fp, AiFinding.IGNORED);
        if (ig.isEmpty()) return false;
        AiFinding f = ig.get();
        f.setLastSeenAt(OffsetDateTime.now());
        repo.save(f);
        return true;
    }

    /** 단일 finding 재분석(캐시된 에러 텍스트로 LLM 재호출). 모델 미존재 등 실패 사유는 diagnosis에 반영. */
    @Transactional
    public AiFinding reanalyze(UUID id) {
        AiFinding f = repo.findById(id).orElseThrow(() -> new IllegalArgumentException("finding 없음: " + id));
        if (llm == null || !llm.isAvailable()) {
            f.setDiagnosis("LLM 미설정 — 시스템 설정에서 분석 모델을 지정하세요.");
        } else {
            String errorText = errorText(parseDetail(f.getDetail()));
            if (errorText.isBlank()) {
                f.setDiagnosis("재분석할 에러 텍스트가 없습니다(원격 조사 필요).");
            } else {
                Map<String, Object> r = llm.analyze(errorText);
                Object rc = r != null ? r.get("rootCause") : null;
                if (rc != null) f.setDiagnosis(String.valueOf(rc));
            }
        }
        f.setLastSeenAt(OffsetDateTime.now());
        return repo.save(f);
    }

    /** 무시: 상태를 IGNORED로 — 목록에서 빠지고 동일 신호가 재발해도 다시 뜨지 않음. */
    @Transactional
    public AiFinding ignore(UUID id) {
        AiFinding f = repo.findById(id).orElseThrow(() -> new IllegalArgumentException("finding 없음: " + id));
        f.setStatus(AiFinding.IGNORED);
        return repo.save(f);
    }

    /** 삭제: 완전 제거(다음 스캔에서 동일 신호면 새로 생성될 수 있음). */
    @Transactional
    public void delete(UUID id) { repo.deleteById(id); }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseDetail(String json) {
        try { return mapper.readValue(json == null || json.isBlank() ? "{}" : json, Map.class); }
        catch (Exception e) { return Map.of(); }
    }

    /** LOG_ERROR_PATTERN 신규 finding은 캐시된 에러 텍스트만으로 LLM 설명을 붙인다(SSH 불필요). */
    private void explainErrorPattern(Suspect s, AiFinding f) {
        if (!AiFinding.LOG_ERROR_PATTERN.equals(s.signalType())) return;
        if (llm == null || !llm.isAvailable()) return;     // 미설정이면 조용히 생략(HA 폴백 철학)
        String errorText = errorText(s.detail());
        if (errorText.isBlank()) return;
        Map<String, Object> r = llm.analyze(errorText);
        Object rc = r != null ? r.get("rootCause") : null;
        if (rc != null) f.setDiagnosis(String.valueOf(rc));
    }

    @SuppressWarnings("unchecked")
    private String errorText(Map<String, Object> detail) {
        if (detail == null) return "";
        Object e = detail.get("errors");
        if (e instanceof List<?> list)
            return list.stream().map(String::valueOf).reduce((a, b) -> a + "\n" + b).orElse("");
        return "";
    }

    @Transactional
    public void recordHigh(Suspect s, ScanFinding sf) { recordHigh(s, sf, AiFinding.REACTIVE); }

    @Transactional
    public void recordHigh(Suspect s, ScanFinding sf, String category) {
        String fp = AiFinding.fingerprint(s.nodeId(), s.signalType());
        Optional<AiFinding> open = repo.findByFingerprintAndStatus(fp, AiFinding.OPEN);
        if (open.isPresent()) {                 // 이미 열림 → 갱신만(제안 중복 방지)
            AiFinding f = open.get();
            f.setLastSeenAt(OffsetDateTime.now());
            if (sf != null) { f.setDiagnosis(sf.diagnosis()); f.setRootCause(sf.rootCause()); }
            repo.save(f);
            return;
        }
        if (refreshIgnored(fp)) return;         // 무시한 신호는 제안도 다시 만들지 않음
        AiFinding f = newFinding(s, category);
        f.setSeverity(sf != null ? sf.severity() : s.severity());
        f.setSummary(sf != null ? sf.summary() : summary(s));
        if (sf != null) { f.setDiagnosis(sf.diagnosis()); f.setRootCause(sf.rootCause()); }
        if (sf != null && sf.proposedActions() != null && !sf.proposedActions().isEmpty()) {
            AiProposal p = ops.createFindingProposal(s.clusterId(), s.nodeId(), summary(s), sf);
            if (p != null) f.setProposalId(p.getId());
        }
        repo.save(f);
    }

    /** scannedCategories에 속한 findings만 reconcile 대상으로 삼는다 —
     *  이번 틱에 스캔하지 않은(꺼진) 카테고리의 기존 open findings는 건드리지 않는다. */
    @Transactional
    public void reconcileResolved(Set<String> activeFingerprints, Set<String> scannedCategories) {
        for (AiFinding f : repo.findByStatusOrderByLastSeenAtDesc(AiFinding.OPEN)) {
            if (scannedCategories.contains(f.getCategory()) && !activeFingerprints.contains(f.getFingerprint())) {
                f.setStatus(AiFinding.RESOLVED);
                f.setResolvedAt(OffsetDateTime.now());
                repo.save(f);
            }
        }
    }

    private AiFinding newFinding(Suspect s, String category) {
        return AiFinding.builder()
                .id(UUID.randomUUID()).clusterId(s.clusterId()).nodeId(s.nodeId())
                .signalType(s.signalType()).severity(s.severity()).status(AiFinding.OPEN)
                .fingerprint(AiFinding.fingerprint(s.nodeId(), s.signalType()))
                .detail(toJson(s.detail()))
                .category(category)
                .firstSeenAt(OffsetDateTime.now()).lastSeenAt(OffsetDateTime.now())
                .createdAt(OffsetDateTime.now())
                .build();
    }
    @SuppressWarnings("unchecked")
    private String summary(Suspect s) {
        if (AiFinding.LOG_ERROR_PATTERN.equals(s.signalType()) && s.detail() != null) {
            Object cnt = s.detail().get("errorCount");
            Object errs = s.detail().get("errors");
            String first = (errs instanceof List<?> l && !l.isEmpty()) ? String.valueOf(l.get(0)) : "";
            return "에러 로그 " + (cnt != null ? cnt : "?") + "건 @ " + s.hostname()
                    + (first.isBlank() ? "" : " — " + first);
        }
        return s.signalType() + " @ " + s.hostname() + " " + s.detail();
    }
    private String toJson(Object o) {
        try { return mapper.writeValueAsString(o); } catch (Exception e) { return "{}"; }
    }
}

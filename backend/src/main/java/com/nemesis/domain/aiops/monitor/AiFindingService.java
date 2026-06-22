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

    public AiFindingService(AiFindingRepository repo, AiOperatorService ops, ObjectMapper mapper) {
        this.repo = repo; this.ops = ops; this.mapper = mapper;
    }

    @Transactional
    public void recordWarn(Suspect s) {
        AiFinding f = touchOrCreate(s);
        f.setSummary(summary(s));
        repo.save(f);
    }

    @Transactional
    public void recordHigh(Suspect s, ScanFinding sf) {
        String fp = AiFinding.fingerprint(s.nodeId(), s.signalType());
        Optional<AiFinding> open = repo.findByFingerprintAndStatus(fp, AiFinding.OPEN);
        if (open.isPresent()) {                 // 이미 열림 → 갱신만(제안 중복 방지)
            AiFinding f = open.get();
            f.setLastSeenAt(OffsetDateTime.now());
            if (sf != null) { f.setDiagnosis(sf.diagnosis()); f.setRootCause(sf.rootCause()); }
            repo.save(f);
            return;
        }
        AiFinding f = newFinding(s);
        f.setSeverity(sf != null ? sf.severity() : s.severity());
        f.setSummary(sf != null ? sf.summary() : summary(s));
        if (sf != null) { f.setDiagnosis(sf.diagnosis()); f.setRootCause(sf.rootCause()); }
        if (sf != null && sf.proposedActions() != null && !sf.proposedActions().isEmpty()) {
            AiProposal p = ops.createFindingProposal(s.clusterId(), s.nodeId(), summary(s), sf);
            if (p != null) f.setProposalId(p.getId());
        }
        repo.save(f);
    }

    @Transactional
    public void reconcileResolved(Set<String> activeFingerprints) {
        for (AiFinding f : repo.findByStatusOrderByLastSeenAtDesc(AiFinding.OPEN)) {
            if (!activeFingerprints.contains(f.getFingerprint())) {
                f.setStatus(AiFinding.RESOLVED);
                f.setResolvedAt(OffsetDateTime.now());
                repo.save(f);
            }
        }
    }

    private AiFinding touchOrCreate(Suspect s) {
        String fp = AiFinding.fingerprint(s.nodeId(), s.signalType());
        return repo.findByFingerprintAndStatus(fp, AiFinding.OPEN).map(f -> {
            f.setLastSeenAt(OffsetDateTime.now());
            return f;
        }).orElseGet(() -> newFinding(s));
    }
    private AiFinding newFinding(Suspect s) {
        return AiFinding.builder()
                .id(UUID.randomUUID()).clusterId(s.clusterId()).nodeId(s.nodeId())
                .signalType(s.signalType()).severity(s.severity()).status(AiFinding.OPEN)
                .fingerprint(AiFinding.fingerprint(s.nodeId(), s.signalType()))
                .detail(toJson(s.detail()))
                .firstSeenAt(OffsetDateTime.now()).lastSeenAt(OffsetDateTime.now())
                .createdAt(OffsetDateTime.now())
                .build();
    }
    private String summary(Suspect s) { return s.signalType() + " @ " + s.hostname() + " " + s.detail(); }
    private String toJson(Object o) {
        try { return mapper.writeValueAsString(o); } catch (Exception e) { return "{}"; }
    }
}

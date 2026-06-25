package com.nemesis.domain.aiops;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nemesis.domain.aiops.dto.AiOpsDtos.*;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.*;

/** SP1: 감지→조사→제안→승인→실행 조율. aibot 불통 시 제안 생략(HA 무영향). */
@Slf4j
@Service
public class AiOperatorService {

    private final AiProposalRepository repo;
    private final AiOperatorClient client;
    private final AiOperatorProperties props;
    private final NodeRepository nodeRepo;
    private final ObjectMapper mapper;

    public AiOperatorService(AiProposalRepository repo, AiOperatorClient client,
                             AiOperatorProperties props, NodeRepository nodeRepo, ObjectMapper mapper) {
        this.repo = repo; this.client = client; this.props = props;
        this.nodeRepo = nodeRepo; this.mapper = mapper;
    }

    @Transactional
    public AiProposal onFault(UUID clusterId, UUID nodeId, String triggerType, String reason) {
        if (!props.isEnabled()) return null;
        Node node = nodeRepo.findById(nodeId).orElse(null);
        Map<String, Object> ctx = new HashMap<>();
        ctx.put("hostname", node != null ? node.getHostname() : "?");
        ctx.put("role", node != null && node.getRole() != null ? node.getRole().name() : "?");
        ctx.put("triggerType", triggerType);
        ctx.put("triggerReason", reason);

        InvestigateResponse r = client.investigate(ctx, sshTarget(node));
        if (r == null) { log.info("aibot 조사 불가 → 제안 생략"); return null; }   // 폴백

        // SP6: 사이드카 자기신고를 신뢰하지 않고 서버에서 위험도/신뢰도/조사차단 재판정.
        ProposalGuardrails.Verdict v =
                ProposalGuardrails.evaluate(r.proposedActions(), r.diagnosis(), r.rootCause(), r.confidence());
        AiProposal p = AiProposal.builder()
                .id(UUID.randomUUID()).clusterId(clusterId).nodeId(nodeId)
                .triggerType(triggerType).triggerReason(reason)
                .diagnosis(r.diagnosis()).rootCause(r.rootCause()).confidence(v.confidence())
                .proposedActions(toJson(v.actions()))
                .maxRiskLevel(v.maxRiskLevel()).requiresManual(v.requiresManual())
                .blocked(v.blocked()).blockedReason(v.blockedReason())
                .status(AiProposal.PENDING)
                .expiresAt(OffsetDateTime.now().plusMinutes(props.getProposalTtlMinutes()))
                .build();
        return repo.save(p);
    }

    @Transactional
    public AiProposal approve(UUID proposalId, String user) {
        AiProposal p = repo.findById(proposalId)
                .orElseThrow(() -> new IllegalArgumentException("제안 없음: " + proposalId));
        if (!AiProposal.PENDING.equals(p.getStatus()))
            throw new IllegalStateException("PENDING 아님: " + p.getStatus());   // 이중 승인 방지
        p.setStatus(AiProposal.EXECUTING);
        p.setDecidedBy(user); p.setDecidedAt(OffsetDateTime.now());
        repo.save(p);

        List<Action> actions = fromJson(p.getProposedActions());
        Node node = p.getNodeId() != null ? nodeRepo.findById(p.getNodeId()).orElse(null) : null;
        ExecuteResponse res = client.execute(proposalId, actions, sshTarget(node));
        if (res == null) {
            p.setStatus(AiProposal.FAILED); p.setExecutionLog("aibot 실행 불가(서비스 불통)");
        } else {
            p.setStatus("SUCCEEDED".equals(res.status()) ? AiProposal.SUCCEEDED : AiProposal.FAILED);
            p.setExecutionLog(toJsonSafe(res));
        }
        return repo.save(p);
    }

    /** SP3: 능동 모니터링 finding의 심각 조치를 PENDING 제안으로 생성. */
    @Transactional
    public AiProposal createFindingProposal(UUID clusterId, UUID nodeId, String triggerReason, ScanFinding f) {
        // SP6: 모니터링 finding → 제안 전환 시에도 동일 가드레일 적용.
        ProposalGuardrails.Verdict v =
                ProposalGuardrails.evaluate(f.proposedActions(), f.diagnosis(), f.rootCause(), f.confidence());
        AiProposal p = AiProposal.builder()
                .id(UUID.randomUUID()).clusterId(clusterId).nodeId(nodeId)
                .triggerType("MONITOR").triggerReason(triggerReason)
                .diagnosis(f.diagnosis()).rootCause(f.rootCause()).confidence(v.confidence())
                .proposedActions(toJson(v.actions()))
                .maxRiskLevel(v.maxRiskLevel()).requiresManual(v.requiresManual())
                .blocked(v.blocked()).blockedReason(v.blockedReason())
                .status(AiProposal.PENDING)
                .expiresAt(OffsetDateTime.now().plusMinutes(props.getProposalTtlMinutes()))
                .build();
        return repo.save(p);
    }

    @Transactional
    public AiProposal reject(UUID proposalId, String user) {
        AiProposal p = repo.findById(proposalId)
                .orElseThrow(() -> new IllegalArgumentException("제안 없음: " + proposalId));
        p.setStatus(AiProposal.REJECTED);
        p.setDecidedBy(user); p.setDecidedAt(OffsetDateTime.now());
        return repo.save(p);
    }

    @Transactional
    public void expireStale() {
        OffsetDateTime now = OffsetDateTime.now();
        for (AiProposal p : repo.findByStatusAndExpiresAtBefore(AiProposal.PENDING, now)) {
            p.setStatus(AiProposal.EXPIRED);
            repo.save(p);
        }
    }

    private Map<String, Object> sshTarget(Node node) {
        Map<String, Object> t = new HashMap<>();
        t.put("host", node != null ? node.getServiceIp() : null);
        t.put("port", 22);
        t.put("user", props.getSshUser());
        return t;
    }

    private String toJson(List<Action> actions) {
        try { return mapper.writeValueAsString(actions); }
        catch (Exception e) { return "[]"; }
    }
    private String toJsonSafe(Object o) {
        try { return mapper.writeValueAsString(o); } catch (Exception e) { return String.valueOf(o); }
    }
    private List<Action> fromJson(String json) {
        try { return mapper.readValue(json == null ? "[]" : json, new TypeReference<List<Action>>() {}); }
        catch (Exception e) { return List.of(); }
    }
}

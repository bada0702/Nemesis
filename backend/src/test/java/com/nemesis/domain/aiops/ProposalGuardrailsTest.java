package com.nemesis.domain.aiops;

import com.nemesis.domain.aiops.dto.AiOpsDtos.Action;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

class ProposalGuardrailsTest {

    @Test void sshKeyCopy_claimedLow_isForcedHigh() {
        // 사용자 시나리오: cp /backup/nemesis_ops .../.ssh/nemesis_ops 를 LLM이 LOW로 신고.
        Action a = new Action("키 복구", "cp /backup/nemesis_ops /root/aibot/.ssh/nemesis_ops", "bot", "LOW");
        ProposalGuardrails.Verdict v =
                ProposalGuardrails.evaluate(List.of(a), "CPU 100%", "원격 진단 키 없음", 0.9);

        assertThat(v.actions().get(0).riskLevel()).isEqualTo(ProposalGuardrails.HIGH);
        assertThat(v.maxRiskLevel()).isEqualTo(ProposalGuardrails.HIGH);
        assertThat(v.requiresManual()).isTrue();
    }

    @Test void chmodOnKey_isHigh() {
        assertThat(ProposalGuardrails.classifyCommand("chmod 600 /root/aibot/.ssh/nemesis_ops"))
                .isEqualTo(ProposalGuardrails.HIGH);
    }

    @Test void serviceRestartAndReboot_areHigh() {
        assertThat(ProposalGuardrails.classifyCommand("systemctl restart xrdp")).isEqualTo(ProposalGuardrails.HIGH);
        assertThat(ProposalGuardrails.classifyCommand("reboot")).isEqualTo(ProposalGuardrails.HIGH);
    }

    @Test void readOnlyDiagnostics_areLow() {
        assertThat(ProposalGuardrails.classifyCommand("top -b -n 1 | head -n 20")).isEqualTo(ProposalGuardrails.LOW);
        assertThat(ProposalGuardrails.classifyCommand("ps -ef")).isEqualTo(ProposalGuardrails.LOW);
        assertThat(ProposalGuardrails.classifyCommand("vmstat 1 5")).isEqualTo(ProposalGuardrails.LOW);
    }

    @Test void rmRf_isHigh_butPlainRmIsMedium() {
        assertThat(ProposalGuardrails.classifyCommand("rm -rf /u01/old")).isEqualTo(ProposalGuardrails.HIGH);
        assertThat(ProposalGuardrails.classifyCommand("rm /tmp/x.log")).isEqualTo(ProposalGuardrails.MEDIUM);
    }

    @Test void blockedInvestigation_capsConfidence() {
        // 원인 미특정 + 차단 마커("missing SSH key", "404"). 신뢰도 0.9 → 0.4 캡.
        ProposalGuardrails.Verdict v = ProposalGuardrails.evaluate(
                List.of(), "Investigation hindered: SSH key missing, metrics 404 Not Found", "", 0.9);

        assertThat(v.blocked()).isTrue();
        assertThat(v.confidence()).isEqualTo(ProposalGuardrails.BLOCKED_CONFIDENCE_CAP, within(1e-9));
        assertThat(v.blockedReason()).isNotBlank();
    }

    @Test void emptyRootCause_marksBlocked() {
        ProposalGuardrails.Verdict v = ProposalGuardrails.evaluate(List.of(), "원인 분석 중", null, 0.8);
        assertThat(v.blocked()).isTrue();
        assertThat(v.confidence()).isLessThanOrEqualTo(ProposalGuardrails.BLOCKED_CONFIDENCE_CAP);
    }

    @Test void realFixWithRootCause_keepsHighConfidence() {
        // 원인 특정 + 비차단이면 신뢰도 보존(데이터를 깎기만 하지 않음).
        Action a = new Action("디스크 정리", "rm /u01/archive/old_*.arc", "db1", "MEDIUM");
        ProposalGuardrails.Verdict v = ProposalGuardrails.evaluate(
                List.of(a), "/u01 96% 사용", "아카이브 로그 미정리로 포화", 0.85);

        assertThat(v.blocked()).isFalse();
        assertThat(v.confidence()).isEqualTo(0.85, within(1e-9));
        assertThat(v.maxRiskLevel()).isEqualTo(ProposalGuardrails.MEDIUM);
        assertThat(v.requiresManual()).isFalse();
    }

    @Test void confidenceIsClampedToValidRange() {
        assertThat(ProposalGuardrails.evaluate(List.of(), "d", "근본원인 명확", 1.5).confidence())
                .isEqualTo(1.0, within(1e-9));
    }
}

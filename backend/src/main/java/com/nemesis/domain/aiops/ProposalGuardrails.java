package com.nemesis.domain.aiops;

import com.nemesis.domain.aiops.dto.AiOpsDtos.Action;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * SP6: AI 조치 제안 가드레일.
 *
 * <p>사이드카(aibot)가 자기신고한 riskLevel·confidence를 신뢰하지 않고, 백엔드가 권위적으로
 * 재판정한다. 핵심 결함 두 가지를 보정한다.
 * <ul>
 *   <li>위험도 과소표기: 인증키 조작·sudo·서비스 재시작·재부팅을 LLM이 LOW로 신고해도 HIGH로 강제.</li>
 *   <li>신뢰도 인플레이션: 원인을 특정하지 못한 "조사 차단" 상태에서 90% 같은 높은 신뢰도를 캡.</li>
 * </ul>
 * 사람의 승인 자체는 막지 않는다(human-in-the-loop). 데이터를 정직하게 만드는 것이 목적이다.
 */
public final class ProposalGuardrails {
    private ProposalGuardrails() {}

    public static final String LOW = "LOW", MEDIUM = "MEDIUM", HIGH = "HIGH";

    /** 조사 차단 시 신뢰도 상한. 원인 미특정이면 그 이상 줄 근거가 없다. */
    public static final double BLOCKED_CONFIDENCE_CAP = 0.4;

    /** 최고 위험(Change Control): 자동 신뢰 금지, 사람 승인 필수로 표시. */
    private static final List<Pattern> HIGH_RISK = List.of(
            // 인증키 생성/복구/교체/권한 — cp /backup/nemesis_ops .../.ssh/... 류를 경로로 포착
            Pattern.compile("\\.ssh/|id_rsa|id_ed25519|id_ecdsa|nemesis_ops|authorized_keys|known_hosts|ssh-keygen|ssh-copy-id"),
            Pattern.compile("\\bchmod\\b|\\bchown\\b|\\bchgrp\\b"),
            Pattern.compile("\\bsudo\\b|\\bsu\\s|\\bpasswd\\b|\\buseradd\\b|\\busermod\\b|\\bgroupadd\\b|\\bvisudo\\b"),
            // 서비스 중단/비활성, 전원
            Pattern.compile("systemctl\\s+(restart|stop|disable|mask|kill)|service\\s+\\S+\\s+(restart|stop)"),
            Pattern.compile("\\breboot\\b|\\bshutdown\\b|\\bhalt\\b|\\bpoweroff\\b|\\binit\\s+[06]\\b"),
            // 파괴적
            Pattern.compile("\\brm\\s+-[a-z]*[rf]|\\bmkfs|\\bdd\\s+if=|>\\s*/dev/|\\bkill(all)?\\s+-9|\\btruncate\\b|\\bfdisk\\b")
    );

    /** 변경/쓰기 계열(중위험). 읽기전용이 아니면 최소 MEDIUM. */
    private static final List<Pattern> MED_RISK = List.of(
            Pattern.compile("\\brm\\b|\\bmv\\b|\\bcp\\b|\\btee\\b|>>?|\\bsystemctl\\s+(start|reload)|"
                    + "\\bapt\\b|\\byum\\b|\\bdnf\\b|\\bpip\\b|\\bnpm\\b|\\bdocker\\b|\\bkill\\b|"
                    + "\\bln\\b|\\bmount\\b|\\bumount\\b|\\bsed\\s+-i|\\bsystemctl\\s+enable")
    );

    /** 조사 차단(원인 미특정)을 시사하는 마커. LLM이 한/영 혼용으로 출력하므로 둘 다 포함. */
    private static final Pattern BLOCKED_MARKER = Pattern.compile(
            "(?i)missing|not\\s+found|404|unavailable|unable|could\\s*n'?t|cannot|can'?t|"
            + "blocked|hindered|prevented|guardrail|no\\s+access|failed|failing|"
            + "실패|불가|없음|차단|확인하지\\s*못|조회\\s*실패|접근\\s*불가|진단\\s*실패|특정하지\\s*못");

    /** 단일 명령의 서버 권위 위험도. */
    public static String classifyCommand(String command) {
        if (command == null || command.isBlank()) return LOW;
        for (Pattern p : HIGH_RISK) if (p.matcher(command).find()) return HIGH;
        for (Pattern p : MED_RISK)  if (p.matcher(command).find()) return MEDIUM;
        return LOW;
    }

    private static int rank(String level) {
        if (HIGH.equalsIgnoreCase(level)) return 2;
        if (MEDIUM.equalsIgnoreCase(level)) return 1;
        return 0;
    }
    private static String label(int rank) { return rank == 2 ? HIGH : rank == 1 ? MEDIUM : LOW; }

    /** 가드레일 판정 결과. */
    public record Verdict(List<Action> actions, String maxRiskLevel, boolean requiresManual,
                          boolean blocked, String blockedReason, double confidence) {}

    /**
     * 제안 전체를 재판정한다. 각 조치의 riskLevel은 max(서버 분류, LLM 신고)로 보수적으로 끌어올리고,
     * 조사 차단이면 신뢰도를 캡한다.
     */
    public static Verdict evaluate(List<Action> rawActions, String diagnosis, String rootCause, double rawConfidence) {
        List<Action> actions = new ArrayList<>();
        int maxRank = -1;
        for (Action a : (rawActions == null ? List.<Action>of() : rawActions)) {
            int server = rank(classifyCommand(a.command()));
            int claimed = rank(a.riskLevel());
            int finalRank = Math.max(server, claimed);
            maxRank = Math.max(maxRank, finalRank);
            actions.add(new Action(a.description(), a.command(), a.target(), label(finalRank)));
        }
        String maxRisk = maxRank < 0 ? null : label(maxRank);
        boolean requiresManual = maxRank >= 2;   // HIGH 조치 1개라도 있으면 사람 승인 필수

        boolean blocked = isBlocked(diagnosis, rootCause);
        String blockedReason = blocked ? blockedReason(diagnosis, rootCause) : null;

        double confidence = clamp01(rawConfidence);
        if (blocked) confidence = Math.min(confidence, BLOCKED_CONFIDENCE_CAP);

        return new Verdict(actions, maxRisk, requiresManual, blocked, blockedReason, confidence);
    }

    /** 원인 미특정(rootCause 공란) 또는 차단 마커가 보이면 조사 차단으로 본다. */
    public static boolean isBlocked(String diagnosis, String rootCause) {
        boolean noRootCause = rootCause == null || rootCause.isBlank();
        boolean marker = BLOCKED_MARKER.matcher(safe(diagnosis) + "\n" + safe(rootCause)).find();
        return noRootCause || marker;
    }

    private static String blockedReason(String diagnosis, String rootCause) {
        if (rootCause == null || rootCause.isBlank())
            return "근본 원인 미특정(rootCause 공란) — 진단 환경 복구 권고일 뿐 장애 조치가 아님";
        return "조사 차단 마커 감지 — 원격 진단/메트릭 조회 실패 가능성. 운영자 확인 필요";
    }

    private static double clamp01(double v) { return v < 0 ? 0 : Math.min(v, 1.0); }
    private static String safe(String s) { return s == null ? "" : s; }
}

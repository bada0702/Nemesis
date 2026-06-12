package com.nemesis.domain.node;

import com.nemesis.domain.cluster.Cluster;
import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "nodes")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Node {

    public enum OsType { AIX, LINUX }

    public enum Role {
        active, standby, fault, recovering;

        /**
         * 프론트엔드 UI 계약 토큰(대문자). DB/도메인은 소문자를 단일 소스로 유지하고,
         * API 경계에서만 이 토큰으로 변환해 프론트(PRIMARY/STANDBY/...)와 정합을 맞춘다(H-1).
         */
        public String uiToken() {
            return switch (this) {
                case active     -> "PRIMARY";
                case standby    -> "STANDBY";
                case fault      -> "FAULT";
                case recovering -> "RECOVERING";
            };
        }

        /** UI 토큰(PRIMARY 등) 또는 도메인명(active 등)을 도메인 Role로 파싱한다. */
        public static Role parse(String raw) {
            if (raw == null) return standby;
            return switch (raw.trim().toUpperCase()) {
                case "PRIMARY", "ACTIVE"      -> active;
                case "STANDBY"                -> standby;
                case "FAULT"                  -> fault;
                case "RECOVERING", "RECOVERY" -> recovering;
                default -> throw new IllegalArgumentException("알 수 없는 role: " + raw);
            };
        }
    }

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "cluster_group_id", nullable = false)
    private Cluster cluster;

    @Column(nullable = false)
    private String hostname;

    @Column(name = "service_ip", length = 50)
    private String serviceIp;

    @Column(name = "heartbeat_ip", length = 50)
    private String heartbeatIp;

    @Enumerated(EnumType.STRING)
    @Column(name = "os_type", nullable = false, length = 20)
    private OsType osType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private Role role = Role.standby;

    @Column(name = "vip", length = 50)
    private String vip;

    @Column(name = "ip_address", length = 50)
    private String ipAddress;

    /** VIP를 올릴 네트워크 인터페이스명(Linux eth0 / AIX en0 등). 페일오버 시 control.sh에 전달. */
    @Column(name = "net_iface", length = 30)
    @Builder.Default
    private String netIface = "eth0";

    @Column(name = "agent_version", length = 50)
    private String agentVersion;

    @Column(name = "last_seen_at")
    private OffsetDateTime lastSeenAt;

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    void prePersist() {
        this.createdAt = OffsetDateTime.now();
    }
}

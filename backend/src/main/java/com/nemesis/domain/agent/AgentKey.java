package com.nemesis.domain.agent;

import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.node.Node;
import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "agent_keys")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AgentKey {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "cluster_group_id", nullable = false)
    private Cluster cluster;

    @Column(name = "api_key", nullable = false, unique = true, length = 100)
    private String apiKey;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "node_id")
    private Node node;

    @Column(name = "expires_at")
    private OffsetDateTime expiresAt;

    @Builder.Default
    private boolean revoked = false;

    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    void prePersist() {
        this.createdAt = OffsetDateTime.now();
    }

    public boolean isValid() {
        if (revoked) return false;
        if (expiresAt != null && OffsetDateTime.now().isAfter(expiresAt)) return false;
        return true;
    }
}

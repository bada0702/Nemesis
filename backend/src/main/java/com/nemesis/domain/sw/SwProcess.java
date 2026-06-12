package com.nemesis.domain.sw;

import com.nemesis.domain.cluster.Cluster;
import com.nemesis.domain.node.Node;
import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;

@Entity
@Table(name = "sw_process")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class SwProcess {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "node_id", nullable = false)
    private Node node;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "cluster_id")
    private Cluster cluster;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(name = "display_name", length = 200)
    private String displayName;

    @Column(nullable = false, length = 20)
    @Builder.Default
    private String type = "KNOWN";

    @Column(length = 20)
    @Builder.Default
    private String status = "unknown";

    private Integer pid;

    @Column(name = "registered_at", updatable = false)
    private OffsetDateTime registeredAt;

    @PrePersist
    void prePersist() { this.registeredAt = OffsetDateTime.now(); }
}

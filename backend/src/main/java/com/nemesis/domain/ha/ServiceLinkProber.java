package com.nemesis.domain.ha;

import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * 각 노드의 serviceIp(real IP) 제어포트에 TCP connect를 시도해 도달성·지연을 측정하고
 * ServiceLinkCache에 저장한다(표시 전용 — 페일오버/감지에는 영향 없음).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ServiceLinkProber {

    private static final int CONNECT_TIMEOUT_MS = 2000;
    private static final int SLOW_THRESHOLD_MS  = 500;

    private final NodeRepository    nodeRepository;
    private final ServiceLinkCache  cache;

    @Value("${nemesis.control-port:17001}")
    private int controlPort;

    @Scheduled(fixedDelayString = "${nemesis.service-link.probe-interval-ms:3000}")
    public void probeAll() {
        for (Node n : nodeRepository.findAll()) {
            try {
                cache.put(n.getId(), probe(n.getServiceIp(), controlPort));
            } catch (Exception e) {
                log.debug("serviceLink 프로브 실패 node={}: {}", n.getId(), e.getMessage());
            }
        }
    }

    /** serviceIp:port 로 TCP connect 시도. 순수 측정(부작용 없음) — 테스트에서 직접 호출. */
    public static ServiceLinkCache.Entry probe(String serviceIp, int controlPort) {
        long now = System.currentTimeMillis();
        if (serviceIp == null || serviceIp.isBlank()) {
            return new ServiceLinkCache.Entry("DEAD", null, now);
        }
        long start = System.nanoTime();
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(serviceIp, controlPort), CONNECT_TIMEOUT_MS);
            int latency = (int) ((System.nanoTime() - start) / 1_000_000);
            String status = latency > SLOW_THRESHOLD_MS ? "SLOW" : "ALIVE";
            return new ServiceLinkCache.Entry(status, latency, now);
        } catch (Exception e) {
            return new ServiceLinkCache.Entry("DEAD", null, now);
        }
    }
}

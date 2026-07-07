package com.nemesis.domain.storage;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.cluster.ClusterRepository;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 공유 스토리지(FC LUN) 인벤토리: 스캔 조회(비영속) + 등록/삭제(영속). */
@Slf4j
@Service
@RequiredArgsConstructor
public class StorageService {

    private final StorageDeviceRepository deviceRepository;
    private final ClusterRepository       clusterRepository;
    private final NodeRepository          nodeRepository;
    private final AgentCommandClient      commandClient;

    private static final Pattern SIZE_PATTERN =
            Pattern.compile("([0-9.]+)\\s*([KMGTP]?)B?", Pattern.CASE_INSENSITIVE);

    public record DiscoveredDevice(String name, String wwid, Long sizeBytes,
                                    int pathCount, boolean alreadyRegistered) {}

    /** storage.sh disk-list의 TSV 출력(name\twwid\tsize\tpaths)을 파싱한다. */
    List<DiscoveredDevice> parseDiskList(String stdout) {
        List<DiscoveredDevice> out = new ArrayList<>();
        if (stdout == null) return out;
        for (String line : stdout.split("\n")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) continue;
            String[] cols = trimmed.split("\t", -1);
            if (cols.length < 4) continue;
            String wwid = cols[1].trim();
            if (wwid.isEmpty()) continue;
            out.add(new DiscoveredDevice(cols[0].trim(), wwid,
                    parseSize(cols[2].trim()), parseIntSafe(cols[3].trim()), false));
        }
        return out;
    }

    /** "10G"/"512M"/"2048" 같은 크기 표기를 바이트로 변환한다(이진 단위). */
    Long parseSize(String s) {
        if (s == null || s.isBlank()) return null;
        Matcher m = SIZE_PATTERN.matcher(s.trim());
        if (!m.matches()) return null;
        double num = Double.parseDouble(m.group(1));
        long mult = switch (m.group(2).toUpperCase()) {
            case "K" -> 1024L;
            case "M" -> 1024L * 1024;
            case "G" -> 1024L * 1024 * 1024;
            case "T" -> 1024L * 1024 * 1024 * 1024;
            case "P" -> 1024L * 1024 * 1024 * 1024 * 1024;
            default -> 1L;
        };
        return (long) (num * mult);
    }

    private int parseIntSafe(String s) {
        try { return Integer.parseInt(s); } catch (NumberFormatException e) { return 0; }
    }
}

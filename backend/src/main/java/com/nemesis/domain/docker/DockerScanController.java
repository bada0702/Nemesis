package com.nemesis.domain.docker;

import com.nemesis.domain.agent.AgentCommandClient;
import com.nemesis.domain.node.Node;
import com.nemesis.domain.node.NodeRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.*;

/**
 * Docker 자동 스캔. 에이전트 명령 채널(17001)로 읽기 전용 control.sh
 * docker-ps / docker-images 를 노드별로 실행해 TSV를 파싱한다.
 * 노드 통신 실패는 전체를 막지 않고 errors로 보고한다(부분 결과 반환).
 */
@RestController
@RequestMapping("/api/docker")
@RequiredArgsConstructor
public class DockerScanController {

    private static final String STATS_MARKER = "---STATS---";

    private final NodeRepository     nodeRepository;
    private final AgentCommandClient commandClient;

    @GetMapping("/containers")
    public ResponseEntity<Map<String, Object>> containers() {
        List<Map<String, Object>> containers = new ArrayList<>();
        List<String> errors = new ArrayList<>();

        for (Node node : nodeRepository.findAll()) {
            AgentCommandClient.Result r = commandClient.execute(node, "control.sh docker-ps");
            if (!r.ok()) { errors.add(node.getHostname() + ": " + summarize(r)); continue; }

            // stdout = 컨테이너 TSV 목록, ---STATS---, 실행중 통계 TSV
            Map<String, String[]> stats = new HashMap<>(); // name -> [cpu, mem]
            List<String[]> rows = new ArrayList<>();
            boolean inStats = false;
            for (String line : r.stdout().split("\n")) {
                if (line.isBlank()) continue;
                if (line.trim().equals(STATS_MARKER)) { inStats = true; continue; }
                String[] f = line.split("\t", -1);
                if (inStats) { if (f.length >= 3) stats.put(f[0], new String[]{f[1], f[2]}); }
                else rows.add(f);
            }
            for (String[] f : rows) {
                if (f.length < 5) continue;
                String[] s = stats.get(f[0]);
                Map<String, Object> c = new LinkedHashMap<>();
                c.put("name",    f[0]);
                c.put("image",   f[1]);
                c.put("status",  f[2]);                       // running / exited ...
                c.put("node",    node.getHostname());
                c.put("ports",   f[3]);
                c.put("cpu",     s != null ? s[0] : "-");
                c.put("mem",     s != null ? s[1] : "-");
                c.put("created", f[4]);
                containers.add(c);
            }
        }
        return ResponseEntity.ok(Map.of("containers", containers, "errors", errors));
    }

    @GetMapping("/images")
    public ResponseEntity<Map<String, Object>> images() {
        List<Map<String, Object>> images = new ArrayList<>();
        List<String> errors = new ArrayList<>();

        for (Node node : nodeRepository.findAll()) {
            AgentCommandClient.Result r = commandClient.execute(node, "control.sh docker-images");
            if (!r.ok()) { errors.add(node.getHostname() + ": " + summarize(r)); continue; }

            for (String line : r.stdout().split("\n")) {
                if (line.isBlank()) continue;
                String[] f = line.split("\t", -1);
                if (f.length < 5) continue;
                Map<String, Object> img = new LinkedHashMap<>();
                img.put("name",    f[0]);
                img.put("tag",     f[1]);
                img.put("node",    node.getHostname());
                img.put("size",    f[2]);
                img.put("created", f[3]);
                img.put("used",    Boolean.parseBoolean(f[4]));
                images.add(img);
            }
        }
        return ResponseEntity.ok(Map.of("images", images, "errors", errors));
    }

    private String summarize(AgentCommandClient.Result r) {
        if (r.error() != null && !r.error().isBlank()) return r.error();
        if (!r.stderr().isBlank()) {
            String s = r.stderr().trim();
            return s.length() > 120 ? s.substring(0, 120) : s;
        }
        return "exit=" + r.exitCode();
    }
}

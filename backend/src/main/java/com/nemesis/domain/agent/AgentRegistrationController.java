package com.nemesis.domain.agent;

import com.nemesis.dto.AgentRegisterRequest;
import com.nemesis.dto.AgentRegisterResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/agent")
@RequiredArgsConstructor
public class AgentRegistrationController {

    private final AgentService agentService;

    @PostMapping("/register")
    public ResponseEntity<AgentRegisterResponse> register(
            @Valid @RequestBody AgentRegisterRequest req) {

        AgentRegisterResponse resp = agentService.register(req);
        return ResponseEntity.ok(resp);
    }
}

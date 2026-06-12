package com.nemesis.security;

import com.nemesis.domain.user.User;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(@RequestBody Map<String, String> body) {
        String username = body.get("username");
        String password = body.get("password");
        if (username == null || password == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "username/password 필요"));
        }
        return authService.login(username, password)
                .<ResponseEntity<Map<String, Object>>>map(r -> ResponseEntity.ok(Map.of(
                        "token", r.token(),
                        "username", r.username(),
                        "role", r.role().name())))
                .orElseGet(() -> ResponseEntity.status(401).body(Map.of("error", "인증 실패")));
    }

    /** 사용자 생성(admin 전용 — RBAC 필터가 보호). */
    @PostMapping("/users")
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, String> body) {
        User u = authService.createUser(
                body.get("username"), body.get("password"),
                User.Role.valueOf(body.getOrDefault("role", "viewer")));
        return ResponseEntity.ok(Map.of("id", u.getId(), "username", u.getUsername(), "role", u.getRole().name()));
    }
}

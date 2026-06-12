package com.nemesis.security;

import lombok.RequiredArgsConstructor;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * 기동 시 기본 admin 계정을 보장한다(없을 때만 생성). 테스트 프로파일에서는 비활성.
 */
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "nemesis.security.bootstrap-admin", havingValue = "true", matchIfMissing = true)
public class SecurityBootstrap implements CommandLineRunner {

    private final AuthService authService;

    @Override
    public void run(String... args) {
        authService.ensureDefaultAdmin();
    }
}

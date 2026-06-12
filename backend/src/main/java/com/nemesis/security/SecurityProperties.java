package com.nemesis.security;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 보안 설정. 운영 환경에서는 반드시 NEMESIS_AUTH_SECRET을 강한 무작위 값으로 지정할 것.
 */
@Component
@ConfigurationProperties(prefix = "nemesis.security")
@Getter
@Setter
public class SecurityProperties {

    /** 토큰 서명 비밀키. 기본값은 개발용 — 운영에서 반드시 교체. */
    private String authSecret = "CHANGE_ME_dev_only_secret_please_override";

    /** 토큰 유효시간(시간). */
    private int tokenHours = 12;

    /** CORS 허용 오리진. 로컬 개발 프론트(5173/3000) + 배포 UI(nginx :18090). '*'(전체개방)에서 축소(H-4). */
    private List<String> allowedOrigins = List.of(
            "http://localhost:5173", "http://localhost:3000", "http://localhost:18090");

    /** 기동 시 admin 계정이 없으면 생성할 기본 비밀번호. */
    private String defaultAdminPassword = "admin";
}

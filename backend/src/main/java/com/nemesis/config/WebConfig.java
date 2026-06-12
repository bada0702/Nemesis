package com.nemesis.config;

import com.nemesis.security.SecurityProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.time.Duration;

@Configuration
@RequiredArgsConstructor
public class WebConfig implements WebMvcConfigurer {

    private final SecurityProperties securityProps;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        // 전체 개방('*')에서 설정된 오리진 화이트리스트로 축소(H-4)
        registry.addMapping("/api/**")
                .allowedOrigins(securityProps.getAllowedOrigins().toArray(new String[0]))
                .allowedMethods("GET", "POST", "PUT", "DELETE", "PATCH")
                .allowedHeaders("*")
                .allowCredentials(true);
    }

    /**
     * 에이전트 명령 채널 호출용 RestTemplate.
     * 죽은 노드 호출이 HA를 막지 않도록 짧은 연결 타임아웃 + 복구 스크립트 실행을 위한 긴 읽기 타임아웃.
     */
    @Bean
    public RestTemplate restTemplate(RestTemplateBuilder builder) {
        return builder
                .setConnectTimeout(Duration.ofSeconds(3))
                .setReadTimeout(Duration.ofSeconds(130))
                .build();
    }
}

package com.nemesis.security;

import com.nemesis.domain.user.User;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Optional;

/**
 * RBAC 게이트.
 * - 제어 API(failover/execute/사용자생성)는 operator/admin 권한 필요.
 * - 그 외 모든 /api 요청(읽기/대시보드 포함)은 로그인 사용자(역할 무관) 필요 → 인프라 정보 무인증 노출 차단.
 * - 공개: 로그인, 에이전트 채널(자체 API키 인증), CORS preflight, actuator.
 *
 * 토큰은 Authorization: Bearer <HMAC 토큰>(로그인으로 발급).
 * 에이전트는 같은 헤더에 자신의 API 키를 싣지만 HMAC 사용자 토큰이 아니므로,
 * 에이전트 채널(/api/agent/** 중 execute 제외)은 사용자 토큰 검증에서 반드시 제외한다.
 */
@Component
@RequiredArgsConstructor
public class RbacFilter extends OncePerRequestFilter {

    private final TokenService tokenService;

    private enum Need { NONE, AUTH, OPERATOR, ADMIN }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {

        Need need = requirement(req.getMethod(), req.getRequestURI());
        if (need == Need.NONE) { chain.doFilter(req, res); return; }

        String auth = req.getHeader("Authorization");
        if (auth == null || !auth.startsWith("Bearer ")) { deny(res, 401, "인증 필요"); return; }

        Optional<TokenService.Principal> p = tokenService.verify(auth.substring(7));
        if (p.isEmpty()) { deny(res, 401, "유효하지 않은 토큰"); return; }

        User.Role role = p.get().role();
        boolean ok = switch (need) {
            case ADMIN    -> role == User.Role.admin;
            case OPERATOR -> role == User.Role.admin || role == User.Role.operator;
            case AUTH     -> true;   // 로그인(유효 토큰)만 되어 있으면 역할 무관 허용
            case NONE     -> true;
        };
        if (!ok) { deny(res, 403, "권한 부족(필요: " + need + ", 보유: " + role + ")"); return; }

        chain.doFilter(req, res);
    }

    private Need requirement(String method, String path) {
        // CORS preflight는 항상 통과(인증 헤더 없이 옴)
        if ("OPTIONS".equalsIgnoreCase(method)) return Need.NONE;

        // 명령 실행은 운영자 사용자 토큰 필요 — 에이전트 채널 공개 규칙보다 먼저 판정
        if (path.matches("/api/agent/[^/]+/execute")) return Need.OPERATOR;

        // 공개(인증 불필요): 로그인 / 에이전트 자체-인증 채널(register·heartbeat·metrics·meta) / actuator
        if (path.equals("/api/auth/login")) return Need.NONE;
        if (path.startsWith("/api/agent/"))  return Need.NONE;
        if (path.startsWith("/actuator"))    return Need.NONE;

        // 변경(제어) API: 역할 권한 필요
        boolean mutating = "POST".equalsIgnoreCase(method)
                || "PUT".equalsIgnoreCase(method) || "DELETE".equalsIgnoreCase(method);
        if (mutating) {
            if ("POST".equalsIgnoreCase(method) && path.equals("/api/auth/users")) return Need.ADMIN;
            if (path.endsWith("/failover"))                  return Need.OPERATOR;  // POST /api/clusters/{id}/failover
            if (path.endsWith("/vip/apply"))                 return Need.OPERATOR;  // POST /api/clusters/{id}/vip/apply
            if (path.endsWith("/vip/down"))                  return Need.OPERATOR;  // POST /api/clusters/{id}/vip/down
            if (path.matches("/api/ai/proposals/[^/]+/(approve|reject)")) return Need.OPERATOR;
            if (path.matches("/api/clusters/[^/]+/config/snapshots/[^/]+/restore")) return Need.OPERATOR;
            if (path.matches("/api/clusters/[^/]+/config/sync")) return Need.OPERATOR;
            if (path.matches("/api/clusters/[^/]+/sync/jobs.*"))          return Need.OPERATOR; // POST/PUT/DELETE/run
            if (path.matches("/api/clusters/[^/]+/sync/provision-ssh"))   return Need.OPERATOR;
            if (path.matches("/api/clusters/[^/]+/storage/.*"))            return Need.OPERATOR; // scan/등록/삭제
        }

        // 그 외 모든 /api 요청(읽기/대시보드 포함): 로그인 사용자 필요
        if (path.startsWith("/api/")) return Need.AUTH;
        return Need.NONE;
    }

    private void deny(HttpServletResponse res, int code, String msg) throws IOException {
        res.setStatus(code);
        res.setContentType("application/json;charset=UTF-8");
        res.getWriter().write("{\"error\":\"" + msg + "\"}");
    }
}

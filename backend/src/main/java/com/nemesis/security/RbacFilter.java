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
 * Phase E-3 RBAC 게이트. 제어 API(failover/execute/사용자생성)만 보호한다.
 * 읽기/대시보드 API와 에이전트 채널(register/metrics/meta)은 영향 없음(과도한 잠금 회피).
 *
 * 권한: 페일오버·명령실행 = operator 이상, 사용자 생성 = admin.
 * 토큰은 Authorization: Bearer <HMAC 토큰>(로그인으로 발급).
 */
@Component
@RequiredArgsConstructor
public class RbacFilter extends OncePerRequestFilter {

    private final TokenService tokenService;

    private enum Need { NONE, OPERATOR, ADMIN }

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
            case NONE     -> true;
        };
        if (!ok) { deny(res, 403, "권한 부족(필요: " + need + ", 보유: " + role + ")"); return; }

        chain.doFilter(req, res);
    }

    private Need requirement(String method, String path) {
        if (!"POST".equalsIgnoreCase(method) && !"DELETE".equalsIgnoreCase(method)) return Need.NONE;
        if ("POST".equalsIgnoreCase(method) && path.equals("/api/auth/users")) return Need.ADMIN;
        if (path.endsWith("/failover"))                  return Need.OPERATOR;  // POST /api/clusters/{id}/failover
        if (path.endsWith("/vip/apply"))                 return Need.OPERATOR;  // POST /api/clusters/{id}/vip/apply
        if (path.endsWith("/vip/down"))                  return Need.OPERATOR;  // POST /api/clusters/{id}/vip/down
        if (path.matches("/api/agent/[^/]+/execute"))    return Need.OPERATOR;
        if (path.matches("/api/ai/proposals/[^/]+/(approve|reject)")) return Need.OPERATOR;
        if (path.matches("/api/clusters/[^/]+/config/snapshots/[^/]+/restore")) return Need.OPERATOR;
        if (path.matches("/api/clusters/[^/]+/config/sync")) return Need.OPERATOR;
        return Need.NONE;
    }

    private void deny(HttpServletResponse res, int code, String msg) throws IOException {
        res.setStatus(code);
        res.setContentType("application/json;charset=UTF-8");
        res.getWriter().write("{\"error\":\"" + msg + "\"}");
    }
}

package com.nemesis.security;

import com.nemesis.domain.user.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Optional;

/**
 * 의존성 없는 HMAC-SHA256 토큰. payload(username|role|expiryEpoch)에 서명한다.
 * 형식: base64url(payload).base64url(hmac)
 */
@Service
@RequiredArgsConstructor
public class TokenService {

    private final SecurityProperties props;

    public record Principal(String username, User.Role role) {}

    public String issue(User user) {
        long exp = System.currentTimeMillis() / 1000 + (long) props.getTokenHours() * 3600;
        String payload = user.getUsername() + "|" + user.getRole().name() + "|" + exp;
        String sig = hmac(payload);
        return enc(payload) + "." + sig;
    }

    public Optional<Principal> verify(String token) {
        try {
            int dot = token.indexOf('.');
            if (dot < 0) return Optional.empty();
            String payload = dec(token.substring(0, dot));
            String sig = token.substring(dot + 1);
            if (!constantTimeEquals(sig, hmac(payload))) return Optional.empty();

            String[] p = payload.split("\\|");
            if (p.length != 3) return Optional.empty();
            long exp = Long.parseLong(p[2]);
            if (System.currentTimeMillis() / 1000 > exp) return Optional.empty();
            return Optional.of(new Principal(p[0], User.Role.valueOf(p[1])));
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private String hmac(String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(props.getAuthSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(mac.doFinal(data.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("HMAC 실패", e);
        }
    }

    private static boolean constantTimeEquals(String a, String b) {
        byte[] x = a.getBytes(StandardCharsets.UTF_8), y = b.getBytes(StandardCharsets.UTF_8);
        if (x.length != y.length) return false;
        int r = 0;
        for (int i = 0; i < x.length; i++) r |= x[i] ^ y[i];
        return r == 0;
    }

    private static String enc(String s) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(s.getBytes(StandardCharsets.UTF_8));
    }
    private static String dec(String s) {
        return new String(Base64.getUrlDecoder().decode(s), StandardCharsets.UTF_8);
    }
}

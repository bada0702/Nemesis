package com.nemesis.security;

import com.nemesis.domain.user.User;
import com.nemesis.domain.user.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final TokenService   tokenService;
    private final SecurityProperties props;

    public record LoginResult(String token, String username, User.Role role) {}

    @Transactional(readOnly = true)
    public Optional<LoginResult> login(String username, String password) {
        return userRepository.findByUsername(username)
                .filter(User::isEnabled)
                .filter(u -> PasswordHasher.verify(password, u.getPasswordHash()))
                .map(u -> new LoginResult(tokenService.issue(u), u.getUsername(), u.getRole()));
    }

    @Transactional
    public User createUser(String username, String password, User.Role role) {
        if (userRepository.findByUsername(username).isPresent()) {
            throw new IllegalArgumentException("이미 존재하는 사용자: " + username);
        }
        return userRepository.save(User.builder()
                .username(username)
                .passwordHash(PasswordHasher.hash(password))
                .role(role)
                .enabled(true)
                .build());
    }

    /** 기동 시 admin 계정이 하나도 없으면 기본 admin 생성. */
    @Transactional
    public void ensureDefaultAdmin() {
        if (userRepository.countByRole(User.Role.admin) > 0) return;
        createUser("admin", props.getDefaultAdminPassword(), User.Role.admin);
        log.warn("기본 admin 계정 생성됨(비밀번호: 설정값). 운영 전 반드시 비밀번호를 변경하세요.");
    }
}

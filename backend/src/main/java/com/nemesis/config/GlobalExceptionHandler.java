package com.nemesis.config;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    // 엔티티 미존재("... not found")가 대부분이라 404로 매핑한다.
    // 과거 401(UNAUTHORIZED)로 매핑돼 있어, 프론트 axios 인터셉터가 이를
    // 세션 만료로 오인해 사용자를 강제 로그아웃시키는 버그가 있었다(노드 삭제 중복클릭 등).
    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<Map<String, String>> handleIllegal(IllegalArgumentException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(IllegalStateException.class)
    ResponseEntity<Map<String, String>> handleState(IllegalStateException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String, String>> handleValidation(MethodArgumentNotValidException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", e.getMessage()));
    }
}

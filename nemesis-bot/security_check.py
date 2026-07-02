#!/usr/bin/env python3
"""수동 보안 점검: git에 추적된 비밀 파일 + 민감 파일 권한 검사."""
import os
import re
import stat
import subprocess
import sys

_SECRET_PATTERNS = [
    re.compile(r"(^|/)\.env$"),
    re.compile(r"credential", re.I),
    re.compile(r"token", re.I),
    re.compile(r"secret", re.I),
    re.compile(r"\.pem$", re.I),
    re.compile(r"(^|/)id_(rsa|ed25519|ecdsa)$"),
]

# 권한이 600/400 이내여야 하는 파일들(존재할 때만 검사).
_SENSITIVE_FILES = [".env", ".ssh/nemesis_ops", "credentials.json", "token_google.json"]


def find_tracked_secrets(tracked_files):
    """추적 파일 목록에서 비밀로 의심되는 항목을 반환."""
    hits = []
    for f in tracked_files:
        if any(p.search(f) for p in _SECRET_PATTERNS):
            hits.append(f)
    return hits


def _git_tracked_files():
    out = subprocess.run(
        ["git", "ls-files"], capture_output=True, text=True
    )
    return [l for l in out.stdout.splitlines() if l]


def _check_permissions():
    problems = []
    for rel in _SENSITIVE_FILES:
        if not os.path.exists(rel):
            continue
        mode = stat.S_IMODE(os.stat(rel).st_mode)
        if mode & 0o077:  # 그룹/기타 권한이 있으면 문제
            problems.append(f"{rel}: 권한이 너무 개방적 ({oct(mode)}), 600 권장")
    return problems


def main():
    problems = []

    secrets = find_tracked_secrets(_git_tracked_files())
    if secrets:
        problems.append("git에 추적된 비밀 의심 파일: " + ", ".join(secrets))

    problems.extend(_check_permissions())

    if problems:
        print("⛔ 보안 점검 실패:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("✅ 보안 점검 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())

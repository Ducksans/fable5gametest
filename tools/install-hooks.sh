#!/bin/sh
# 가드 훅 설치 — 클론 후 한 번 실행하면 커밋마다 가드가 강제된다.
# 사용: sh tools/install-hooks.sh
cp tools/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
echo "✅ pre-commit 훅 설치 완료 — 이제 모든 커밋 전 tools/guard.mjs 가 fail-closed로 강제됩니다."

[English](./README.md) | [한국어](./README.ko.md)

![Version](https://img.shields.io/badge/version-1.2.1-333333?style=flat-square)
[![License: MIT License](https://img.shields.io/badge/License-MIT%20License-yellow.svg)](./LICENSE)
[![npm downloads](https://img.shields.io/npm/dm/%40bytonylee%2Ffree-router)](https://www.npmjs.com/package/@bytonylee/free-router)
[![CI](https://github.com/bytonylee/free-router/actions/workflows/ci.yml/badge.svg)](https://github.com/bytonylee/free-router/actions/workflows/ci.yml)

무료 AI 모델 라우터 CLI - OpenCode / OpenClaw용 무료 모델을 탐색, 핑 테스트, 설정합니다.

![free-router 터미널 데모](./public/example.gif)

## 설치

```bash
npx @bytonylee/free-router
# 또는
npm i -g @bytonylee/free-router
# 또는
bunx @bytonylee/free-router
# 또는
bun install -g @bytonylee/free-router
```

## 실행

```bash
free-router
```

최초 실행 시 API 키 설정 마법사가 시작됩니다 (ESC로 각 프로바이더를 건너뛸 수 있습니다).

앱 내 업데이트 프롬프트에서 `Y`를 선택하면 전역 업데이트 후 free-router가 자동으로
재시작되어, `free-router`를 다시 입력하지 않아도 바로 이어서 사용할 수 있습니다.

## free-router 사용하는 방법

1. **최초 실행 온보딩 마법사**
   `free-router` 실행 → 브라우저로 키 발급 페이지 열기 → API 키 입력 → 바로 시작.
2. **대화형 모델 검색 + 즉시 실행**
   `/`로 모델을 필터링하고 `Enter`로 OpenCode 설정을 갱신한 뒤 `opencode`를 바로 엽니다.
3. **메인 화면 빠른 API 키 수정**
   `A` (또는 만료/누락 추정 시 `R`)로 키 편집 화면에 바로 진입하고, 누락 키는 브라우저 자동 오픈.
4. **전체 설정 워크플로**
   `P`에서 키 편집, 프로바이더 on/off, 실시간 키 테스트, 누락 키 온보딩 수행.
5. **비대화형 최적 모델 선택**
   `free-router --best`로 스크립트에서 사용할 최적 모델 ID를 출력.

## 프로바이더

| 프로바이더     | 무료 키 발급                                                                         |
| -------------- | ------------------------------------------------------------------------------------ |
| **NVIDIA NIM** | [build.nvidia.com](https://build.nvidia.com/settings/api-keys) - 접두사 `nvapi-`     |
| **OpenRouter** | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) - 접두사 `sk-or-` |

API 키 우선순위: 환경 변수 → `~/.free-router.json` → 키 없이 핑 (응답 속도는 그래도 표시됩니다).

```bash
NVIDIA_API_KEY=nvapi-xxx free-router
OPENROUTER_API_KEY=sk-or-xxx free-router

# 선택 사항: 스크롤 중 자동 재정렬 일시정지 시간(ms)
FREE_ROUTER_SCROLL_SORT_PAUSE_MS=2500 free-router

# 선택 사항: 롤링 메트릭 캐시 비활성화(레거시 재계산 경로 강제)
FREE_ROUTER_METRICS_CACHE=0 free-router
```

## TUI (터미널 UI)

모든 모델을 2초마다 병렬로 핑하며 실시간 응답 속도, 가동률, 상태를 표시합니다.
선택된 행은 고정 마커를 사용하고, 터미널 포커스가 없을 때는 다시 그리기를 미뤄 백그라운드 탭 깜빡임을 줄입니다.

### 컬럼 설명

| 컬럼       | 설명                                                   |
| ---------- | ------------------------------------------------------ |
| `#`        | 순위                                                   |
| `Tier`     | SWE-bench 점수 기반 성능 등급 (S+ → C)                 |
| `Provider` | NIM 또는 OpenRouter                                    |
| `Model`    | 모델 이름                                              |
| `Ctx`      | 컨텍스트 윈도우 크기                                   |
| `AA`       | Arena Elo / 지능 점수                                  |
| `Avg`      | HTTP 200 응답만을 기준으로 한 평균 응답 속도           |
| `Lat`      | 마지막으로 측정된 핑 응답 속도                         |
| `Up%`      | 현재 세션 가동률                                       |
| `Verdict`  | 상태 요약 (✓ Perfect / ✓ Normal / x Overloaded / …)    |

기본 정렬 기준: **응답 가능 모델 우선**, 그 다음 **높은 등급 우선** (S+ → S → A+ …), 그 다음 낮은 응답 속도.

검색 바 프로바이더 배지:

- `이름:✓` 키 존재 + 정상 추정
- `이름:✗` 만료/인증 실패 추정
- `이름:○` 키 없음

`?` 도움말 오버레이와 `A` API 키 편집 화면은 메인 목록과 같은 터미널
헤더/푸터 스타일을 사용합니다. 모드 태그는 왼쪽에 고정되고, 도움말 본문
텍스트는 테이블 행과 같은 글자색을 사용합니다.

### 키보드 단축키

**탐색**

| 키              | 동작             |
| --------------- | ---------------- |
| `↑` / `k`       | 위로 이동        |
| `↓` / `j`       | 아래로 이동      |
| `PgUp` / `PgDn` | 페이지 위 / 아래 |
| `g`             | 맨 위로 이동     |
| `G`             | 맨 아래로 이동   |

**액션**

| 키             | 동작                                                    |
| -------------- | ------------------------------------------------------- |
| `Enter`        | 설정 저장 + 현재 모델로 `opencode` 실행                 |
| `/`            | 모델 검색 / 필터 (검색 중 Enter = `opencode` 실행)      |
| `A`            | 빠른 API 키 추가/변경 (설정 키 편집 화면으로 이동)      |
| `R`            | 만료/누락 추정 프로바이더 키 편집으로 바로 이동         |
| `T`            | 등급 필터 순환: 전체 → S+ → S → A+ → …                  |
| `P`            | 설정 화면 (키 편집, 프로바이더 활성화/비활성화, 테스트) |
| `W` / `X`      | 핑 간격 빠르게 / 느리게                                 |
| `?`            | 도움말 오버레이                                         |
| `q` / `Ctrl+C` | 종료                                                    |

**정렬** (해당 키를 누르면 정렬, 다시 누르면 역순)

| 키  | 컬럼              |
| --- | ----------------- |
| `0` | 우선순위 (기본값) |
| `1` | 등급              |
| `2` | 프로바이더        |
| `3` | 모델 이름         |
| `4` | 평균 응답 속도    |
| `5` | 마지막 핑         |
| `6` | 가동률            |
| `7` | 컨텍스트 윈도우   |
| `8` | 상태 요약         |
| `9` | AA 지능 점수      |

### OpenCode 실행

모델에서 `Enter`를 누르면 OpenCode 설정을 저장하고 곧바로 `opencode`를 실행합니다.

OpenCode fallback로 프로바이더가 바뀌는 경우(예: NIM Stepfun → OpenRouter),
실제 프로바이더 API 키가 없으면 다음 확인 프롬프트가 표시됩니다:
`Add API key now? (Y/n, default: Y)`.

모델 메타데이터상 선택한 모델이 알려진 타깃 지원 목록에서 지원되지 않는 경우,
free-router는 기본 고성능 모델인 NVIDIA NIM `deepseek-ai/deepseek-v4-pro`로
fallback합니다.

설정 파일 경로:

- **OpenCode CLI** → `~/.config/opencode/opencode.json`
- **OpenClaw** → `~/.openclaw/openclaw.json`

기존 설정 파일은 덮어쓰기 전 자동으로 백업됩니다.

free-router가 OpenCode를 실행할 때는 기본적으로 `OPENCODE_CLI_RUN_MODE=true`
(이미 값이 설정된 경우는 유지) 를 전달하여, OpenCode TUI 시작 시
플러그인 자동 업데이트 체크 로그가 섞여 보이는 현상을 줄입니다.

기본 OpenCode 시작 훅 동작을 그대로 원하면 다음처럼 실행하세요:

```bash
OPENCODE_CLI_RUN_MODE=false free-router
```

### 설정 화면 (`P`)

팁: 메인 목록에서 `A`를 누르면 키 편집으로 바로 이동합니다.
팁: 선택한 프로바이더 키가 없으면, 설정 세션 동안 프로바이더별 1회씩 키 발급 페이지를 자동으로 엽니다
(처음 진입 시 + 선택 이동 시 모두 적용).

| 키                    | 동작                              |
| --------------------- | --------------------------------- |
| `↑` / `↓` / `j` / `k` | 프로바이더 탐색                   |
| `Enter`               | API 키 인라인 편집                |
| `Space`               | 프로바이더 활성화 / 비활성화 토글 |
| `T`                   | 실시간 테스트 핑 실행             |
| `D`                   | 현재 프로바이더의 키 삭제         |
| `ESC`                 | 메인 목록으로 돌아가기            |

## 플래그

| 플래그          | 동작                                                 |
| --------------- | ---------------------------------------------------- |
| _(없음)_        | 대화형 TUI                                           |
| `--best`        | 비대화형: 4라운드 핑 후 최적 모델 ID를 stdout에 출력 |
| `--help` / `-h` | 도움말 표시                                          |

### `--best` 스크립트 사용

```bash
# 약 10초 분석 후 최적 모델 ID 출력
free-router --best

# 변수에 저장
MODEL=$(free-router --best)
echo "최적 모델: $MODEL"
```

API 키가 최소 하나 이상 설정되어 있어야 합니다. 선택 기준: 응답 상태=up → 평균 응답 속도 낮을수록 → 가동률 높을수록.

## 설정 파일

`~/.free-router.json` 에 저장됩니다 (권한 `0600`).

```json
{
  "apiKeys": {
    "nvidia": "nvapi-xxx",
    "openrouter": "sk-or-xxx"
  },
  "providers": {
    "nvidia": { "enabled": true },
    "openrouter": { "enabled": true }
  },
  "ui": {
    "scrollSortPauseMs": 1500
  }
}
```

`ui.scrollSortPauseMs` 는 탐색 입력 이후 자동 재정렬을 얼마나 오래 멈출지(ms) 설정합니다.
`FREE_ROUTER_SCROLL_SORT_PAUSE_MS` 환경 변수가 있으면 설정값보다 우선합니다. `0`이면 일시정지를 끕니다.

## 등급 기준 (SWE-bench Verified)

| 등급   | 점수   | 설명            |
| ------ | ------ | --------------- |
| **S+** | ≥ 70%  | 최상위 프론티어 |
| **S**  | 60–70% | 우수            |
| **A+** | 50–60% | 뛰어남          |
| **A**  | 40–50% | 양호            |
| **A-** | 35–40% | 준수            |
| **B+** | 30–35% | 평균            |
| **B**  | 20–30% | 평균 이하       |
| **C**  | < 20%  | 경량 / 엣지용   |

## 상태 요약 (Verdict)

| 상태         | 조건                           |
| ------------ | ------------------------------ |
| x Overloaded | 마지막 HTTP 코드 = 429         |
| x Unstable   | 이전엔 응답했으나 현재 실패 중 |
| x Not Active | 한 번도 응답하지 않음          |
| - Pending    | 첫 번째 성공 응답 대기 중      |
| ✓ Perfect    | 평균 < 400 ms                  |
| ✓ Normal     | 평균 < 1000 ms                 |
| x Slow       | 평균 < 3000 ms                 |
| x Very Slow  | 평균 < 5000 ms                 |
| x Unusable   | 평균 ≥ 5000 ms                 |

## 개발 노트

- 소스 오브 트루스는 TypeScript `src/` 입니다.
- ESLint 설정도 TypeScript 파일(`eslint.config.ts`)로 관리합니다.
- 런타임 JavaScript는 `npm run build` 시 `dist/`에만 생성됩니다.

## 라이선스

MIT License입니다. 자세한 내용은 [LICENSE](./LICENSE)를 참고하세요.

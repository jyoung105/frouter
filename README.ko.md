# frouter

[![CI](https://github.com/jyoung105/frouter/actions/workflows/ci.yml/badge.svg)](https://github.com/jyoung105/frouter/actions/workflows/ci.yml)

무료 AI 모델 라우터 CLI — OpenCode / OpenClaw용 무료 모델을 탐색, 핑 테스트, 설정합니다.

![frouter-gif](./frouter-example.gif)

## 설치

```bash
npx frouter-cli
# 또는
npm i -g frouter-cli
# 또는
bunx frouter-cli
# 또는
bun install -g frouter-cli
```

## 실행

```bash
frouter
```

최초 실행 시 API 키 설정 마법사가 시작됩니다 (ESC로 각 프로바이더를 건너뛸 수 있습니다).

## 최초 실행 온보딩 테스트 (클린 상태)

실제 설치/설정을 지우지 않고, 임시 `HOME`에서 완전 초기 상태 온보딩을 테스트할 수 있습니다.

```bash
npm run test:onboarding
npm run test:fresh-start
```

`test:fresh-start` 실행 시:

- 임시 홈에 `~/.frouter.json` 이 없는 상태로 시작
- 프로바이더 환경 변수 키(`NVIDIA_API_KEY`, `OPENROUTER_API_KEY`) 비활성화
- 실제 `~/.frouter.json` 은 변경하지 않음

옵션:

```bash
npm run test:fresh-start -- --keep-home
```

종료 후 임시 `HOME` 디렉터리를 유지하여 결과 파일을 확인할 수 있습니다.

## 프로바이더

| 프로바이더     | 무료 키 발급                                                                    |
| -------------- | ------------------------------------------------------------------------------- |
| **NVIDIA NIM** | [build.nvidia.com](https://build.nvidia.com/settings/api-key) — 접두사 `nvapi-` |
| **OpenRouter** | [openrouter.ai/keys](https://openrouter.ai/keys) — 접두사 `sk-or-`              |

API 키 우선순위: 환경 변수 → `~/.frouter.json` → 키 없이 핑 (응답 속도는 그래도 표시됩니다).

```bash
NVIDIA_API_KEY=nvapi-xxx frouter
OPENROUTER_API_KEY=sk-or-xxx frouter
```

## TUI (터미널 UI)

모든 모델을 2초마다 병렬로 핑하며 실시간 응답 속도, 가동률, 상태를 표시합니다.

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
| `Lat`      | 마지막 핑 응답 속도                                    |
| `Up%`      | 현재 세션 가동률                                       |
| `Verdict`  | 상태 요약 (🚀 Perfect / ✅ Normal / 🔥 Overloaded / …) |

기본 정렬 기준: **응답 가능 모델 우선**, 그 다음 **높은 등급 우선** (S+ → S → A+ …), 그 다음 낮은 응답 속도.

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

| 키             | 동작                                                        |
| -------------- | ----------------------------------------------------------- |
| `Enter`        | 모델 선택 → 타겟 선택 (OpenCode / OpenClaw)                 |
| `/`            | 모델 검색 / 필터 (검색 중 Enter = 두 타겟 모두에 즉시 적용) |
| `T`            | 등급 필터 순환: 전체 → S+ → S → A+ → …                      |
| `P`            | 설정 화면 (키 편집, 프로바이더 활성화/비활성화, 테스트)     |
| `W` / `X`      | 핑 간격 빠르게 / 느리게                                     |
| `?`            | 도움말 오버레이                                             |
| `q` / `Ctrl+C` | 종료                                                        |

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

### 타겟 선택 화면

모델에서 `Enter`를 누른 후:

| 키            | 동작                           |
| ------------- | ------------------------------ |
| `↑` / `↓`     | 탐색 (OpenCode CLI / OpenClaw) |
| `Enter` / `G` | 설정 저장 + 도구 실행          |
| `S`           | 설정 저장만 (실행 없음)        |
| `ESC`         | 취소                           |

OpenCode fallback로 프로바이더가 바뀌는 경우(예: NIM Stepfun → OpenRouter),
실제 프로바이더 API 키가 없으면 다음 확인 프롬프트가 표시됩니다:
`Launch opencode anyway? (Y/n, default: n)`.

설정 파일 경로:

- **OpenCode CLI** → `~/.config/opencode/opencode.json`
- **OpenClaw** → `~/.openclaw/openclaw.json`

기존 설정 파일은 덮어쓰기 전 자동으로 백업됩니다.

### 설정 화면 (`P`)

| 키        | 동작                              |
| --------- | --------------------------------- |
| `↑` / `↓` | 프로바이더 탐색                   |
| `Enter`   | API 키 인라인 편집                |
| `Space`   | 프로바이더 활성화 / 비활성화 토글 |
| `T`       | 실시간 테스트 핑 실행             |
| `D`       | 현재 프로바이더의 키 삭제         |
| `ESC`     | 메인 목록으로 돌아가기            |

## 플래그

| 플래그          | 동작                                                 |
| --------------- | ---------------------------------------------------- |
| _(없음)_        | 대화형 TUI                                           |
| `--best`        | 비대화형: 4라운드 핑 후 최적 모델 ID를 stdout에 출력 |
| `--help` / `-h` | 도움말 표시                                          |

### `--best` 스크립트 사용

```bash
# 약 10초 분석 후 최적 모델 ID 출력
frouter --best

# 변수에 저장
MODEL=$(frouter --best)
echo "최적 모델: $MODEL"
```

API 키가 최소 하나 이상 설정되어 있어야 합니다. 선택 기준: 응답 상태=up → 평균 응답 속도 낮을수록 → 가동률 높을수록.

## 설정 파일

`~/.frouter.json` 에 저장됩니다 (권한 `0600`).

```json
{
  "apiKeys": {
    "nvidia": "nvapi-xxx",
    "openrouter": "sk-or-xxx"
  },
  "providers": {
    "nvidia": { "enabled": true },
    "openrouter": { "enabled": true }
  }
}
```

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

| 상태          | 조건                           |
| ------------- | ------------------------------ |
| 🔥 Overloaded | 마지막 HTTP 코드 = 429         |
| ⚠️ Unstable   | 이전엔 응답했으나 현재 실패 중 |
| 👻 Not Active | 한 번도 응답하지 않음          |
| ⏳ Pending    | 첫 번째 성공 응답 대기 중      |
| 🚀 Perfect    | 평균 < 400 ms                  |
| ✅ Normal     | 평균 < 1000 ms                 |
| 🐢 Slow       | 평균 < 3000 ms                 |
| 🐌 Very Slow  | 평균 < 5000 ms                 |
| 💀 Unusable   | 평균 ≥ 5000 ms                 |

## 테스트

```bash
npm run lint
npm test
npm run typecheck

# 선택: 성능 기준선/회귀 테스트
npm run perf:baseline
npm run test:perf
```

## 모델 카탈로그 자동 동기화 (GitHub Actions)

`frouter`는 모델 메타데이터를 최신 상태로 유지하기 위한 스케줄 워크플로를 포함합니다.

- 워크플로: `.github/workflows/model-catalog-sync.yml`
- 실행 트리거:
  - 매일: `17 3 * * *` (UTC)
  - 주간 AA 갱신: `47 4 * * 1` (UTC)
  - 수동 실행: `workflow_dispatch`
- 업데이트 대상:
  - `model-rankings.json`
  - `model-support.json` (OpenCode 지원 모델 맵)
- 변경사항이 있으면 `chore/model-catalog-sync` 브랜치 PR을 생성/업데이트합니다.
- 신규 모델 tier가 미해결이면 PR에 `needs-tier-review` 라벨이 붙습니다.

워크플로에서 사용하는 저장소 시크릿:

- `NVIDIA_API_KEY`
- `OPENROUTER_API_KEY`
- `ARTIFICIAL_ANALYSIS_API_KEY`

로컬 동기화 명령:

```bash
npm run models:sync
npm run models:sync:apply
```

## 개발 노트

- 소스 오브 트루스는 TypeScript `src/` (앱 + 테스트) 입니다.
- ESLint 설정도 TypeScript 파일(`eslint.config.ts`)로 관리합니다.
- 런타임 JavaScript는 `npm run build` 시 `dist/`에만 생성됩니다.
- 테스트는 빌드 후 `dist/tests/` 산출물을 기준으로 실행됩니다.

# 설정 가이드 (Phase 1b)

로컬(LocalRepo, 인증 없음)에서 Supabase + Vercel 배포로 넘어가는 절차입니다.
`.env.local`이 없으면 앱은 그대로 로컬 모드로 동작합니다 — 이 문서는 클라우드로
옮길 때만 필요합니다.

## 1. Supabase 프로젝트 만들기 (데이터베이스 전용 — 로그인에는 안 씀)

1. https://supabase.com → New Project.
2. **Region: Seoul (ap-northeast-2)** 선택 (지연시간 최소화).
3. 프로젝트가 뜨면 좌측 메뉴 **Project Settings → API**로 이동:
   - `Project URL` → `.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`
   - `service_role` / `secret` 키 → `SUPABASE_SERVICE_ROLE_KEY` (절대 커밋 금지, 절대 클라이언트에 노출 금지)
4. **Project Settings → Access Tokens**에서 새 토큰 발급 → `SUPABASE_ACCESS_TOKEN`.
   프로젝트 URL의 `ref` 부분(`https://<project-ref>.supabase.co`) → `SUPABASE_PROJECT_REF`.
   (DB 비밀번호를 몰라도 되도록, 마이그레이션은 이 Management API 토큰으로 실행합니다.)

로그인은 Supabase Auth를 쓰지 않습니다 — 무료 플랜 기본 SMTP는 이메일 템플릿을
수정할 수 없어서 OTP 코드 발송 자체가 불가능하기 때문입니다 (매직 링크는 아이폰
홈 화면 앱에서 로그인이 안 됨). 대신 아래 3번의 앱 비밀번호 방식을 씁니다.

## 2. `.env.local` 채우기

`cp .env.example .env.local` 후 값을 채웁니다:

```
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_ACCESS_TOKEN=...
SUPABASE_PROJECT_REF=...
APP_PASSWORD=원하는 비밀번호
SESSION_SECRET=아래 명령으로 생성한 임의의 긴 문자열
CAPTURE_TOKEN=아래 명령으로 생성한 임의의 긴 문자열
INGEST_TOKEN=위와 동일하게 별도로 생성
CRON_SECRET=위와 동일하게 별도로 생성
```

토큰 생성 예시: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 3. 스키마 적용 + 데이터 이전

```bash
npm run db:migrate        # supabase/migrations/*.sql 적용 (여러 번 실행해도 안전)
npm run db:import -- --dry-run   # 몇 건이 옮겨질지 먼저 확인
npm run db:import         # 실제 이전 (.data/db.json이 있으면 그걸, 없으면 data/seed.local.json)
```

(두 명령 모두 `.env.local`을 자동으로 읽습니다.)

## 4. Vercel 배포

1. GitHub에 이 저장소를 올리고 Vercel에서 **Import Project**.
2. **Environment Variables**에 `.env.local`의 값을 모두 등록: `NEXT_PUBLIC_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `APP_PASSWORD`, `SESSION_SECRET`, `CAPTURE_TOKEN`,
   `INGEST_TOKEN`, `CRON_SECRET`. `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF`는
   배포 환경에는 필요 없음 (마이그레이션은 로컬에서 실행).
3. `LOCAL_PROBES=0`도 추가 — 배포 환경(Vercel)에는 PC의 트레이딩 대시보드/git 저장소가
   없으므로 로컬 프로브 대신 `/api/ingest`로 들어온 마지막 스냅샷을 보여줍니다.
4. 배포 후 `vercel.json`의 cron이 자동 등록됩니다 (매일 07시대 KST — UTC 22:00, 무료 플랜은 그 1시간 안 아무 때나 실행, `/api/cron/daily`).
5. 주의: Supabase를 설정했는데 `APP_PASSWORD`/`SESSION_SECRET`을 빼먹고 배포하면
   앱이 열린 채로 서비스되지 않도록 500 에러로 막습니다 — 둘 다 반드시 등록하세요.

## 5. iOS 단축어(Shortcut)로 메모 캡처

공유 시트에서 바로 메모를 남기는 단축어입니다.

1. 아이폰 **단축어 앱 → 새 단축어**.
2. **"공유 시트에서 받기"** 켜기, 입력 타입: 텍스트 (또는 URL/텍스트 모두).
3. 동작 추가: **URL의 콘텐츠 가져오기(Get Contents of URL)**
   - URL: `https://<배포된 도메인>/api/capture`
   - 방법: POST
   - 헤더: `Authorization` = `Bearer <CAPTURE_TOKEN 값>`, `Content-Type` = `application/json`
   - 요청 본문(JSON): `{ "text": "공유 입력값" }` (단축어의 "공유 시트 입력" 변수를 text에 매핑)
4. 이름을 정하고 저장. 이제 사파리/사진/메모 등 공유 시트에서 이 단축어를 선택하면
   즉시 메모함(인박스)에 들어갑니다.
5. **홈 화면에 추가**: 배포된 URL을 Safari로 열고 공유 → "홈 화면에 추가"를 하면
   PWA로 설치됩니다. 로그인(비밀번호)은 이 앱에서 한 번만 하면 됩니다 — 세션은
   90일간 유지되고, 30일 이하로 남으면 자동으로 연장됩니다.

## 6. 문제 해결

- **로그인이 안 됨**: `.env.local`의 `APP_PASSWORD`와 실제로 입력한 값이 같은지 확인.
  5회 연속 실패하면 10분간 잠깁니다.
- **배포하자마자 500 에러("Auth not configured...")**: `APP_PASSWORD`/`SESSION_SECRET`을
  Vercel 환경 변수에 등록하지 않은 상태입니다 (4번 5항 참고).
- **상태 패널이 비어 있음(클라우드)**: 아직 `/api/ingest`로 아무것도 보낸 적이 없기
  때문입니다. PC에서 `npm run collector` (환경변수 `CLOUD_URL`, `INGEST_TOKEN` 필요)를
  수동으로 실행해 보세요.
- **백업**: Supabase 무료 플랜은 자동 백업이 없습니다. 로그인 후 `/api/export`에
  접속하면 전체 데이터를 JSON으로 내려받을 수 있습니다 — 가끔 저장해 두세요.

## 7. PC 수집기 스케줄링 (phase 2a)

`scripts/collector.mjs`가 매시간 git/세션/백로그 상태를 모아 `/api/ingest`로 보냅니다.
`.env.local`에 `CLOUD_URL`, `INGEST_TOKEN` (그리고 필요하면 `TRADING_URL`)이 있어야 합니다.

```powershell
powershell -File scripts\register-collector-task.ps1
```

Windows 작업 스케줄러에 `CommandCenterCollector` 작업을 등록합니다 (매 60분 + 로그온 시,
사용자가 로그인해 있을 때만, 5분 제한시간). 이미 있으면 지우고 다시 등록합니다(멱등).
수동 1회 실행은 `npm run collector`.

## 8. 텔레그램 봇 (phase 2b)

메모 캡처(`@프로젝트 #태그` 지원), `/today`, `/deadlines`, 매일 아침(07시대) 브리핑, 긴급
상태 즉시 알림을 제공하는 개인용 비공개 봇입니다.

1. BotFather에서 봇을 만들고 토큰을 `.env.local`의 `TELEGRAM_BOT_TOKEN`에 넣습니다.
2. 봇에게 아무 메시지나 한 번 보냅니다 (채팅 id를 찾기 위함).
3. `npm run telegram:setup` 실행 — `TELEGRAM_CHAT_ID`/`TELEGRAM_WEBHOOK_SECRET`을
   자동으로 채우고, 웹훅과 명령어 목록을 등록합니다.
4. Vercel 환경 변수까지 같이 등록하려면: `npm run telegram:setup -- --vercel`
   (`.env.local`의 `VERCEL_TOKEN` 필요). 연결 테스트 메시지까지 보내려면
   `--send-test`를 추가하고, 반영을 위해 재배포합니다.
5. 봇 토큰이 잘못됐다면 "토큰이 올바르지 않습니다" 메시지와 함께 종료됩니다 —
   BotFather에서 다시 확인 후 재실행하세요.

`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`/`TELEGRAM_WEBHOOK_SECRET` 중 하나라도
없으면 봇 관련 기능은 전부 조용히 꺼집니다 (캡처/조회/크론/알림 모두 정상 동작,
텔레그램으로 보내는 부분만 생략).

## 9. 에이전트 인박스 SessionStart 훅 (phase 2a)

프로젝트 디렉터리에서 Claude Code 세션을 시작할 때, 그 프로젝트에 배정된 에이전트
할 일과 "전송됨" 메모를 세션에 자동으로 보여줍니다 (`scripts/cc-inbox.mjs` +
`GET /api/agent-inbox`). `.env.local`에 `CLOUD_URL`, `AGENT_TOKEN`이 있어야 합니다.

등록은 `~/.claude/settings.json` (Windows용, WSL용 각각 따로 — 홈 디렉터리가 다름)에
`hooks.SessionStart`를 추가합니다. WSL 쪽은 `node`가 시스템 Node 18이므로
`scripts/cc-inbox.mjs`가 Node 18에서 그대로 동작하도록 만들어져 있습니다 (plain ESM,
`--env-file` 미사용).

Windows `~/.claude/settings.json` (경로는 실제 클론 위치로 교체):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"C:\\Users\\<user>\\Desktop\\Work\\personal-dashboard\\scripts\\cc-inbox.mjs\" hook",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

WSL `~/.claude/settings.json` (같은 파일을 WSL 쪽 경로로):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /mnt/c/Users/<user>/Desktop/Work/personal-dashboard/scripts/cc-inbox.mjs hook",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

기존에 다른 `SessionStart` 훅이 있다면 배열에 추가만 하면 됩니다. 훅은 항상 exit 0이고,
전달할 항목이 없거나 `CLOUD_URL`/`AGENT_TOKEN` 미설정·타임아웃(3초)이면 아무것도 출력하지
않습니다 — 세션 시작을 막거나 늦추지 않습니다. 완료 처리는 훅이 출력해 준 명령을 그대로
실행: `node "<스크립트 경로>" done <id>`.

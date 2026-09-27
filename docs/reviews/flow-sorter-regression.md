# flow-sorter 기능 누락 조사 — 인력 가능 스킬 · 로그

조사일 2026-09-27 · 읽기 전용 · 대상 `traicer-corp/flow-sorter` HEAD `bf39589`
원 보고: "실질 활용시에 이전에 있던 기능들이 몇가지 없어졌는데 (원장 등 인력 가능 스킬 로그)"

## 0. 결론 요약

1. **삭제된 코드는 없다. 숨겨졌고, 연결이 끊겼다.** 2026-08-27 `dcf08b2`(S2-D)에서 레거시 "병원 관리" 탭 링크가 nav에서 숨겨졌다. 이 탭에 의료진 목록과 스킬 편집이 있었다. 지금은 admin 역할이 `/?tab=admin`을 직접 입력해야만 열린다.
2. **레거시 스킬 화면은 이미 보드와 무관했다.** 레거시 화면은 `doctors` 테이블을 편집하고, 운영 보드는 `board_staff` 테이블을 읽는다. 이름이 같아도 두 테이블은 연결돼 있지 않다. 그래서 레거시 화면을 다시 노출해도 보드에는 아무 영향이 없다(함정).
3. **운영 보드 직원(board_staff)을 관리하는 UI는 처음부터 없었다.** 직원 추가/이름변경/비활성/스킬 입력은 시드 스크립트나 API 직접 호출로만 가능하다. 백엔드 라우트와 `skills` 컬럼, 스킬 필터 추천 로직은 이미 있다. 다만 스킬 값이 비어 있어서 추천이 전원을 "스킬 제한 없음"으로 취급하고 있다.
4. **"로그"는 기록만 되고 볼 화면이 없다.** 보드의 모든 전이/수정은 `board_audit_log`에 기록되지만 조회 API와 UI가 하나도 없다. 과거 차트(`/admin/history`)와 원장 점수(`/admin/scores`)는 존재하지만 admin 역할에게만 보이고, 진입 링크는 TopBar의 "기준정보 관리" → AdminNav 하나뿐이다. 오너가 이 화면들을 못 찾았을 가능성도 있다.

## 1. 타임라인

| 날짜 | 커밋 | 사건 |
|---|---|---|
| v1.x (Streamlit) | `68aba31`~`1b2589e` | "병원 관리 > ■ 의료진"에서 원장 추가/활성/삭제 + 스킬 multiselect(`SPECIALIZED_CATEGORIES`={필러, 실리프팅}). 이 카테고리는 스킬 보유 원장에게만 강제 배정(`core/allocator.py:930`) |
| 2026-04-25 | `9db888a`, `2a097f1`, `8dc795f` | Next.js `DoctorAdmin.tsx`: 계층형 스킬 카탈로그(보톡스/EBD/실리프팅/캐뉼라…). 카탈로그 정의는 **localStorage**에 저장, 원장별 선택은 `doctors.skills` JSONB에 저장 |
| 2026-07-04 | `7307d11`, `5f8b67b` | 운영 보드 출시. `board_staff`(name/role/floor/languages/**skills TEXT**/is_active)가 별도 테이블로 생김. 레거시 `doctors`와 연결 없음 |
| 2026-07-06 | `f3eaf7a`, `90d3283` | 원장 제안(고스트 칩) — `board_staff.skills` 기반 필터(`board_logic.py:1012`) + 금일 부하 정렬 |
| 2026-08-27 | `dcf08b2` | **레거시 격리**: `appTabs.ts` `SHOW_ADMIN_TAB_LINK=false`, `SHOW_DASHBOARD_TAB=false`, `page.tsx` `LEGACY_GANTT_ENTRY_ENABLED=false`. "병원 관리"(의료진·스킬) 링크가 사라짐 ← **체감 회귀 시점** |
| 2026-08-27 | `b7bf623`, `bf39589` | 새 `/admin`: 시술실·기기 탭만 있음. 과거 차트·원장 점수 추가. **직원·시술 카탈로그·로그 탭은 없음** |

## 2. 기능별 현황

| # | 기능 | 예전 위치 | 현재 상태 | 데이터/백엔드 | 보드의 현재 처리 |
|---|---|---|---|---|---|
| F1 | 원장/직원 명부 관리(추가·활성·삭제) | Streamlit `app.py:1829` → `components/features/Admin/DoctorAdmin.tsx` (`/?tab=admin` → PIN "0000" → ■ 의료진) | 레거시 화면은 URL 직행으로만 접근 가능(proxy 게이트②, admin 역할 전용). **편집 대상 `doctors`는 보드가 읽지 않음** | `board_staff` + `GET/POST/PATCH /board/staff` (`board.py:985-1032`), DELETE 없음(비활성으로 대체). 쓰기는 proxy 게이트③으로 admin 전용 | 팝오버가 `board_staff`를 역할·활성 기준으로만 필터(`BoardApp.tsx:144-146`). 직원 추가는 `scripts/import_board_seed.py`로만 가능. **FE에 createStaff/patchStaff가 없음**(`lib/boardApi.ts:154` listStaff만 있음) |
| F2 | 인력별 가능 스킬(시술 자격) | 위와 같은 화면의 스킬 칩 | 레거시 칩은 `doctors.skills`에 저장되고 보드와 무관. 카탈로그는 브라우저 localStorage에만 있음 | `board_staff.skills` TEXT(JSON 배열 또는 콤마 구분, `parse_skills` `board_logic.py:985`). **시드가 skills를 채우지 않음**(`import_board_seed.py:322`은 name/role/languages만 채움) | 원장 제안: 스킬 비어 있음=전원 가능(와일드카드), 값이 있으면 시술명/카테고리와 부분문자열 또는 rapidfuzz≥85로 매칭(`board_logic.py:1012-1021`, `1077`). **직접 선택 팝오버에는 스킬 경고가 없음**. 피부/간호 슬롯은 스킬을 아예 쓰지 않음 |
| F3 | 로그(누가·언제·무엇) | 레거시 `logs`는 AI 배정 입출력 기록(`allocate.py:21`)이며 UI는 한 번도 없었음. Streamlit은 카드 완료 탭 + 👍/👎 피드백(GoldenRecord)이 있었음 | **감사 로그 조회 UI/API 없음** | `board_audit_log`(row_id, visit_id, actor_name, action, field, old/new, at). 행 액션·PATCH·생성/삭제·층이동·이월·기준정보(층/방/기기)·view_scores가 기록됨. **staff·catalog PATCH는 기록 안 됨**(`board.py:1012`, `1065`) | 없음. 행에 `prepared_by`/`cleanup_by`/`cancelled_by`가 저장되지만 FE는 표시하지 않음(`useBoardState.ts:135-140`은 병합만 함) |
| F4 | 과거 기록·실적 | 레거시 없음 | `/admin/history`(과거 차트, 읽기 전용), `/admin/scores`(원장 점수) **있음**, admin 전용 | `GET /board/history`, `/history/dates`, `/scores` | 비-admin에게는 보이지 않음. 진입은 TopBar "기준정보 관리"(admin만 노출) → AdminNav |
| F5 | 시술 기준(LUT) 관리 | Streamlit/Next "■ 시술 기준" = Google Sheets → `procedures_lut` 동기화 | 레거시 탭은 숨겨짐. **보드가 쓰는 `procedure_catalog`에는 관리 UI가 없음** | `GET/POST/PATCH /board/catalog` 있음. `procedures_lut` 동기화는 catalog에 반영되지 않음 | 자동완성 + minutes=점수 단가. 새 시술 추가나 분·executor_role 수정은 API/시드로만 가능 |
| F6 | 근무/퇴근 가용성 | 레거시에도 없었음(CLAUDE.md Known Limitation 1) | 없음 | plan `docs/ops-board-plan.md:21`에 "퇴근 예정 시각", `:43`에 "퇴근시간 고려"로 계획만 있음. 컬럼 없음 | 휴무자도 활성이면 팝오버/제안에 나옴 |

부수 발견:
- CLAUDE.md Known Limitation 4("Skill-procedure matching not enforced in allocator")는 사실과 다르다. `fastapi-backend/app/core/allocator.py:1001-1002`가 필러/실리프팅을 강제한다. 다만 레거시 AI 경로 한정이다. 문서 수정을 권장한다.
- 레거시 `AdminTabs.tsx:24`에 클라이언트 PIN "0000"이 하드코딩돼 있고 화면에도 노출된다(`:61`). 레거시 화면을 되살리지 않는다면 무해하다.

## 3. 복구 계획 (실사용 우선순위)

### P0-a. `/admin` "직원" 탭 (F1+F2) — 핵심
- **BE**: 라우트 재사용. 수정은 3가지.
  1. `create_staff`/`patch_staff`에 `write_audit(action="create_staff"|"patch_staff", actor_name=role, field, old, new)` 추가. rooms 패턴(`board.py:714`, `753`)을 그대로 따른다.
  2. 이름 가드: trim, 같은 role 안에서 활성 이름 중복이면 422. `doctor_name`은 텍스트로 저장되고 점수는 TRIM(doctor_name)으로 묶이기 때문이다.
  3. `skills` 저장 형식을 **JSON 배열 문자열**로 고정한다(스키마 validator). 마이그레이션은 필요 없다.
- **FE**: `lib/boardApi.ts`에 `createStaff`/`patchStaff`를 추가한다. `BoardAdminApp.tsx`의 `AdminTab`에 `"staff"`를 추가하고 `StaffPanel.tsx`를 새로 만든다. 구성은 다음과 같다.
  - 역할별 그룹(원장/피부/간호/코디/상담), 인라인 이름·층·언어 편집, 활성 토글(낙관적 반영 + 롤백). `useBoardAdmin` 패턴을 재사용한다.
  - 스킬 칩: 후보는 `listCatalog()`의 **category + name** 목록이다. 레거시처럼 localStorage 카탈로그를 두지 않는다. 자유 입력 칩도 허용한다. 매칭 로직이 부분문자열/퍼지라서 "필러"만 입력해도 동작한다.
  - 라벨은 "비워두면 모든 시술 가능"으로 명시한다(현재 와일드카드 의미를 그대로 드러냄).
  - 이름 변경 시 경고: "과거 기록·점수는 옛 이름으로 남습니다".
- proxy 게이트③이 이미 `/staff` 쓰기를 admin으로 제한하므로 추가 게이트는 필요 없다.

### P0-b. 레거시 함정 제거
- `/?tab=admin` → `/admin?tab=staff`로 리다이렉트한다(`app/page.tsx`의 redirect 한 줄 + proxy 게이트②는 유지). 대안으로 `DoctorAdmin.tsx` 상단에 "이 화면의 변경은 운영 보드에 반영되지 않습니다" 배너를 둘 수 있다.
- (선택) 1회성 스크립트 `scripts/migrate_doctor_skills.py`: `doctors.skills`(id 형식 "filler.basic")를 라벨로 바꿔 같은 이름의 `board_staff(role=doctor).skills`에 복사한다. 라벨 사전은 `DoctorAdmin.tsx:26-70`의 DEFAULT_CATALOG다. 커스텀 칩 라벨은 브라우저 localStorage에만 있어서 복구할 수 없다. **실행 전에 오너 확인이 필요하다**(운영 DB에 의미 있는 값이 있는지).

### P1-a. 보드에서 스킬 경고 (F2 적용)
- 차단하지 않고 **경고만** 한다. 원칙 1 "모든 실수는 되돌릴 수 있게", 원칙 3 "시술 중 상호작용 요구 금지"를 따른다.
- **BE**: `GET /board/rows/{id}/eligible-staff?slot=doctor|skin1|…` 추가. 기존 `_is_skill_eligible`을 재사용하고 `[{name, eligible, reason}]`를 반환한다. rapidfuzz 로직을 FE에 복제하지 않기 위해서다.
- **FE**: `StaffPopover`(`Popovers.tsx:68`)에서 가능한 직원을 먼저 보여주고, 불가능한 직원은 흐리게 + "스킬 없음" 꼬리표를 붙이되 클릭은 허용한다. 불가능한 직원을 고르면 토스트 "OOO: 등록된 스킬에 '시술명' 없음"을 띄운다.
- 테스트: skills=`["필러"]`, 시술 "쥬비덤 필러 1cc" → eligible. 시술 "울쎄라 300샷" → ineligible. skills 비어 있으면 → eligible(와일드카드). catalog category로도 매칭돼야 한다.

### P1-b. 로그 뷰어 (F3)
- **BE**: `GET /board/audit?date=YYYY-MM-DD&row_id=&visit_id=&actor=&action=&limit=200&before_id=` 추가. KST 일자 스코프로 조회하고, row/visit를 조인해 환자명·시술명을 붙인다. proxy `ADMIN_READ_GATE_RE`에 `audit`를 추가한다(`proxy.ts:892`).
- **FE**: `/admin/logs` 페이지 + AdminNav 탭 "변경 이력"을 추가한다. 표 컬럼은 시각 / 행위자 / 동작(한글 매핑: prepare→준비, doctor_start→원장 시작 …) / 환자·시술 / 필드 / 이전→이후. `/admin/history` 행을 클릭하면 해당 row_id로 필터된 로그를 연다.
- 함께 고칠 것: staff·catalog PATCH 감사 누락(위 P0-a와 동일 패턴).

### P2-a. `/admin` "시술" 탭 (F5)
- 기존 `/board/catalog` CRUD를 쓴다. 편집 항목은 name / category / minutes(=점수) / executor_role(doctor·skin·nurse) / allowed_room_kind / 활성이다. minutes 변경은 점수에 영향을 주므로 감사 로그가 필수다.

### P2-b. 오늘 근무/퇴근 (F6) — 신규 기능, 오너 결정 후
- 최소안: `board_staff.off_until TIMESTAMP NULL`(또는 `today_off_date DATE`)을 마이그레이션으로 추가한다. 직원 탭과 팝오버에서 "오늘 휴무" 토글을 두고, 해당 직원은 제안/팝오버 하단으로 내린다. 자정이 지나면 자동으로 해제된다.

### 하지 않을 것
- 레거시 `logs` / `history` / `golden_records` / `doctors` UI 부활. 이 테이블들은 AI 간트 경로 전용이고 보드와 무관하다.

## 4. 오너 결정 필요

1. **"로그"가 가리키는 것**: (a) 누가 무엇을 바꿨는지 감사 이력, (b) 과거 날짜 보드(이미 `/admin/history`에 있음), (c) 원장별 실적(이미 `/admin/scores`에 있음). (b)나 (c)라면 진입 경로만 고치면 된다. 예: TopBar에 admin용 "과거 차트" 링크 추가.
2. **스킬 의미**: 현재는 허용목록(비어 있으면 전부 가능)이다. plan 문구 "필러 불가 원장"(`ops-board-plan.md:21`)처럼 **불가목록**이 현장 입력에 더 쉬울 수 있다. 어느 쪽으로 할지 정해야 한다.
3. **강제 수준**: 경고만(권장) 할지, admin 외에는 차단할지.
4. **스킬 적용 범위**: 원장만 할지, 피부/간호도 포함할지(피부 슬롯 제안 로직은 없음).
5. **로그 열람 권한**: admin만 볼지, 팀장/전원에게 행 단위 이력을 보여줄지.
6. 레거시 `doctors.skills` 값을 이관할지, 새로 입력할지.
7. 퇴근/휴무 모델링(P2-b)을 진행할지.

## 5. 리뷰 체크리스트 (구현 후, 위험 순)

1. 직원 이름 변경/중복이 점수 집계(TRIM(doctor_name))와 과거 행 표시를 깨지 않는가
2. `skills` 저장 형식이 JSON 배열로 일관되고 `parse_skills` 왕복이 되는가(쉼표 포함 라벨 등)
3. `/staff`·`/audit` 게이트: 비-admin이 POST/PATCH하면 403, `/audit` GET도 403
4. 스킬 경고가 선택을 막지 않는가(1클릭 유지), 와일드카드 직원은 경고가 없는가
5. 감사 로그 조회가 KST 일자 경계를 정확히 지키는가(UTC `at` 저장)
6. 로그 API 페이지네이션 상한이 있고, 보드 폴링 경로에 섞이지 않았는가
7. staff/catalog 변경이 보드 팝오버에 반영되는가(BoardApp 쿼리 refetch 주기)
8. `/?tab=admin` 리다이렉트 후 레거시 화면으로 가는 링크가 남아 있지 않은가

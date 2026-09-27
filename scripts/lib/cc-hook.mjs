// Plain JS, Node >=18. Pure pieces of the Command Center SessionStart/Stop hooks
// (see cc-inbox.mjs), split out so the decision logic is unit-testable without
// stdin/git/fs plumbing.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "없음" (no file/updatedAt/mtime yet), "최근 갱신" (< 1 day old), or "N일 전 갱신".
 * @param {number | null} updatedAtOrMtimeMs
 * @param {number} nowMs
 * @returns {string}
 */
export function statusStateText(updatedAtOrMtimeMs, nowMs) {
  if (updatedAtOrMtimeMs == null || !Number.isFinite(updatedAtOrMtimeMs)) return '없음';
  const days = Math.floor((nowMs - updatedAtOrMtimeMs) / DAY_MS);
  if (days < 1) return '최근 갱신';
  return `${days}일 전 갱신`;
}

/** The SessionStart protocol block text, printed for every managed project. */
export function protocolBlock(root, stateText) {
  return [
    '## Command Center 기록 규칙',
    '이 프로젝트는 개인 커맨드센터 대시보드에 표시돼요. 의미 있는 작업 단위를 끝낼 때마다(그리고 세션을 마치기 전에)',
    `${root}/docs/cc-status.json 을 갱신하세요: {updatedAt, focus, next[], blockers[], done[{date,text}], checklist[{text,status,section?,owner?}]}`,
    '- done 은 최신순 최대 10개, 각 항목 한 줄. next/blockers 는 최대 8개.',
    '- checklist 는 이 프로젝트의 실제 작업 목록(코드·문서·운영 상태 기준으로 최신화)이며 대시보드 진행률로 쓰입니다. 항목을 끝내면 즉시 done 으로 바꾸세요.',
    '- owner: 사용자가 직접 해야 하는 일(판단·실험·외부 연락·수동 확인 등)은 "me", Claude가 처리할 수 있는 일은 "agent".',
    '- 비밀값·토큰·환자/개인 정보·계좌번호·보유 종목은 절대 쓰지 마세요. 요약만.',
    '- 기존 파일이 있으면 읽고 병합(덮어쓰기 전에 done 이력 유지). 커밋해도 됩니다.',
    `현재 상태: ${stateText}`,
  ].join('\n');
}

/**
 * Whether the Stop hook should nudge: only when the marker exists and hasn't
 * already reminded this session, there were commits since the session started,
 * and docs/cc-status.json is missing or older than the session start.
 * @param {{ marker: { startedAt: string, reminded: boolean } | null, hasCommits: boolean, statusMtimeMs: number | null }} args
 * @returns {boolean}
 */
export function shouldRemind({ marker, hasCommits, statusMtimeMs }) {
  if (!marker || marker.reminded) return false;
  if (!hasCommits) return false;
  const startedAtMs = Date.parse(marker.startedAt);
  if (!Number.isFinite(startedAtMs)) return false;
  return statusMtimeMs == null || statusMtimeMs < startedAtMs;
}

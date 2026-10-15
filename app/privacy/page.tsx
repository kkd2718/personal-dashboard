// Public privacy notice (no login) — required to publish the Google OAuth app used by
// the /cal calendar write path (docs/PLAN_AX.md slice 2).
export const metadata = { title: '개인정보처리방침 · Command Center' };

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 p-6 text-sm leading-relaxed">
      <h1 className="text-lg font-semibold">개인정보처리방침</h1>
      <p>
        Command Center는 운영자 한 명이 자신의 일정·할 일을 관리하기 위해 쓰는 개인용 대시보드입니다. 다른
        사용자에게 서비스를 제공하지 않습니다.
      </p>
      <h2 className="font-medium">Google 사용자 데이터</h2>
      <ul className="list-disc pl-5">
        <li>운영자 본인의 Google 캘린더에 일정을 추가하는 데에만 Google Calendar API(calendar.events)를 사용합니다.</li>
        <li>받은 데이터는 운영자 본인의 대시보드 표시에만 쓰며, 제3자에게 판매·공유하지 않습니다.</li>
        <li>광고나 프로필 생성에 사용하지 않습니다.</li>
        <li>접근 토큰은 서버 환경변수에만 보관하며, 운영자가 Google 계정 설정에서 언제든 권한을 철회할 수 있습니다.</li>
      </ul>
      <p>
        Google API에서 받은 정보의 사용은 Limited Use 요구사항을 포함한 Google API Services User Data Policy를
        따릅니다.
      </p>
      <p className="text-foreground/50">최종 수정: 2026-10-15</p>
    </main>
  );
}

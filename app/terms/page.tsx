// Public terms of service (no login) — required alongside /privacy to publish the
// Google OAuth app used by the /cal calendar write path.
export const metadata = { title: '서비스 약관 · Command Center' };

export default function TermsPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 p-6 text-sm leading-relaxed">
      <h1 className="text-lg font-semibold">서비스 약관</h1>
      <p>
        Command Center는 운영자 한 명이 자신의 일정·할 일을 관리하기 위해 만든 개인용 도구이며, 일반에 제공되는
        서비스가 아닙니다. 운영자 외의 계정은 로그인하거나 사용할 수 없습니다.
      </p>
      <ul className="list-disc pl-5">
        <li>이 도구는 있는 그대로 제공되며, 가용성이나 정확성을 보장하지 않습니다.</li>
        <li>연결된 Google 계정의 데이터는 개인정보처리방침에 따라서만 사용합니다.</li>
        <li>운영자는 언제든 Google 계정 설정에서 연결 권한을 철회할 수 있습니다.</li>
      </ul>
      <p>
        <a href="/privacy" className="underline">
          개인정보처리방침
        </a>
      </p>
      <p className="text-foreground/50">최종 수정: 2026-10-15</p>
    </main>
  );
}

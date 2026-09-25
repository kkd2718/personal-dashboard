import { redirect } from 'next/navigation';

// 1c renamed 인박스 → 메모. Keep the old URL working.
export default function InboxRedirect() {
  redirect('/memo');
}

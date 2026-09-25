import { redirect } from 'next/navigation';

// 1c renamed 마감 → 캘린더. Keep the old URL working.
export default function DeadlinesRedirect() {
  redirect('/calendar');
}

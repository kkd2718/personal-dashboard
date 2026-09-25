import { revalidatePath } from 'next/cache';

/** Revalidate every screen that can show derived data after a mutation. */
export function revalidateAll(): void {
  revalidatePath('/');
  revalidatePath('/memo');
  revalidatePath('/projects', 'layout');
  revalidatePath('/papers');
  revalidatePath('/calendar');
}

import { revalidatePath } from 'next/cache';

/** Revalidate every screen that can show derived data after a mutation. */
export function revalidateAll(): void {
  revalidatePath('/');
  revalidatePath('/inbox');
  revalidatePath('/projects', 'layout');
  revalidatePath('/papers');
  revalidatePath('/deadlines');
}

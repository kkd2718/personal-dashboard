// Tailwind class names must be literal in source for the JIT scanner to pick them
// up, so project accent colors are mapped through this static table instead of
// interpolating `project.color` into a class string.

export interface ColorClasses {
  dot: string; // small solid dot
  bar: string; // calendar range bar background
  text: string; // accent text
  chip: string; // light background chip (progress bars, badges)
}

const TABLE: Record<string, ColorClasses> = {
  blue: { dot: 'bg-blue-500', bar: 'bg-blue-500/80', text: 'text-blue-600 dark:text-blue-400', chip: 'bg-blue-100 dark:bg-blue-950' },
  cyan: { dot: 'bg-cyan-500', bar: 'bg-cyan-500/80', text: 'text-cyan-600 dark:text-cyan-400', chip: 'bg-cyan-100 dark:bg-cyan-950' },
  emerald: { dot: 'bg-emerald-500', bar: 'bg-emerald-500/80', text: 'text-emerald-600 dark:text-emerald-400', chip: 'bg-emerald-100 dark:bg-emerald-950' },
  teal: { dot: 'bg-teal-500', bar: 'bg-teal-500/80', text: 'text-teal-600 dark:text-teal-400', chip: 'bg-teal-100 dark:bg-teal-950' },
  violet: { dot: 'bg-violet-500', bar: 'bg-violet-500/80', text: 'text-violet-600 dark:text-violet-400', chip: 'bg-violet-100 dark:bg-violet-950' },
  indigo: { dot: 'bg-indigo-500', bar: 'bg-indigo-500/80', text: 'text-indigo-600 dark:text-indigo-400', chip: 'bg-indigo-100 dark:bg-indigo-950' },
  amber: { dot: 'bg-amber-500', bar: 'bg-amber-500/80', text: 'text-amber-600 dark:text-amber-400', chip: 'bg-amber-100 dark:bg-amber-950' },
  orange: { dot: 'bg-orange-500', bar: 'bg-orange-500/80', text: 'text-orange-600 dark:text-orange-400', chip: 'bg-orange-100 dark:bg-orange-950' },
  rose: { dot: 'bg-rose-500', bar: 'bg-rose-500/80', text: 'text-rose-600 dark:text-rose-400', chip: 'bg-rose-100 dark:bg-rose-950' },
  red: { dot: 'bg-red-500', bar: 'bg-red-500/80', text: 'text-red-600 dark:text-red-400', chip: 'bg-red-100 dark:bg-red-950' },
  pink: { dot: 'bg-pink-500', bar: 'bg-pink-500/80', text: 'text-pink-600 dark:text-pink-400', chip: 'bg-pink-100 dark:bg-pink-950' },
  fuchsia: { dot: 'bg-fuchsia-500', bar: 'bg-fuchsia-500/80', text: 'text-fuchsia-600 dark:text-fuchsia-400', chip: 'bg-fuchsia-100 dark:bg-fuchsia-950' },
  lime: { dot: 'bg-lime-500', bar: 'bg-lime-500/80', text: 'text-lime-600 dark:text-lime-400', chip: 'bg-lime-100 dark:bg-lime-950' },
  sky: { dot: 'bg-sky-500', bar: 'bg-sky-500/80', text: 'text-sky-600 dark:text-sky-400', chip: 'bg-sky-100 dark:bg-sky-950' },
  yellow: { dot: 'bg-yellow-500', bar: 'bg-yellow-500/80', text: 'text-yellow-600 dark:text-yellow-400', chip: 'bg-yellow-100 dark:bg-yellow-950' },
  stone: { dot: 'bg-stone-500', bar: 'bg-stone-500/80', text: 'text-stone-600 dark:text-stone-400', chip: 'bg-stone-100 dark:bg-stone-950' },
  slate: { dot: 'bg-slate-500', bar: 'bg-slate-500/80', text: 'text-slate-600 dark:text-slate-400', chip: 'bg-slate-100 dark:bg-slate-950' },
  gray: { dot: 'bg-gray-500', bar: 'bg-gray-500/80', text: 'text-gray-600 dark:text-gray-400', chip: 'bg-gray-100 dark:bg-gray-950' },
};

const FALLBACK: ColorClasses = TABLE.slate;

/** All valid `Project.color` keys, in swatch-picker display order (project-edit-form.tsx). */
export const PROJECT_COLORS = Object.keys(TABLE);

export function projectColorClasses(color: string | null | undefined): ColorClasses {
  return (color && TABLE[color]) || FALLBACK;
}

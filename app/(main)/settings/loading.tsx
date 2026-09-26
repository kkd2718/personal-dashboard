import { Skeleton } from '@/components/ui/skeleton';

export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-6 w-16" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-14 w-full" />
        </div>
      ))}
    </div>
  );
}

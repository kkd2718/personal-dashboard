import { Skeleton } from '@/components/ui/skeleton';

export default function PapersLoading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-6 w-24" />
      <Skeleton className="h-9 w-full" />
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-72 flex-1" />
        ))}
      </div>
    </div>
  );
}

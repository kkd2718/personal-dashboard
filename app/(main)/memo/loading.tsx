import { Skeleton } from '@/components/ui/skeleton';

export default function MemoLoading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-6 w-24" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-8 w-full" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-16" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}

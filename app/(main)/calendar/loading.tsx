import { Skeleton } from '@/components/ui/skeleton';

export default function CalendarLoading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-6 w-20" />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Skeleton className="h-[520px] w-full" />
        <Skeleton className="h-[520px] w-full" />
      </div>
    </div>
  );
}

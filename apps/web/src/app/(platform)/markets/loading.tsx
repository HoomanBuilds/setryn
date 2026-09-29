import { Skeleton } from "@/components/markets/ui";

/** Shown while the directory route streams in: the same frame, drawn in shimmer. */
export default function MarketsLoading() {
  return (
    <section aria-busy="true" aria-label="Loading markets" className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-hidden bg-app lg:p-1">
      <div className="flex h-[62px] items-center gap-4 border-b border-line bg-panel px-3 lg:rounded-lg lg:border lg:px-4">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-24" />
        <span className="ml-auto hidden gap-6 lg:flex">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-7 w-20" />
          ))}
        </span>
      </div>
      <div className="hidden grid-cols-2 gap-1 md:grid xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex h-[128px] flex-col gap-3 rounded-lg border border-line bg-panel p-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 border-y border-line bg-panel p-3 lg:rounded-lg lg:border">
        <Skeleton className="h-6 w-2/5" />
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton key={index} className="h-7 w-full" />
        ))}
      </div>
    </section>
  );
}

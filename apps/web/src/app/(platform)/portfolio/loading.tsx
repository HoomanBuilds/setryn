import { Skeleton } from "@/components/markets/ui";

/** The tab body streams inside the shared portfolio frame, so only it shimmers. */
export default function PortfolioLoading() {
  return (
    <div aria-busy="true" aria-label="Loading portfolio view" className="flex flex-col gap-3 p-3 lg:p-4">
      <Skeleton className="h-7 w-64" />
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </div>
  );
}

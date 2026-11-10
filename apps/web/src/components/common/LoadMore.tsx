import { Button } from "@/components/ui/button";

export function LoadMore({ hasMore, loading, onClick, shown, total }: { hasMore: boolean; loading: boolean; onClick: () => void; shown: number; total?: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t py-3 text-xs text-muted-foreground">
      <span aria-live="polite">{total !== undefined ? `Showing ${shown} of ${total}` : `Showing ${shown}`}</span>
      {hasMore ? (
        <Button variant="outline" size="sm" onClick={onClick} loading={loading}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}

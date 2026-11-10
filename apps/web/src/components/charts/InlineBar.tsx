/** A thin horizontal bar for use inside a table cell; `ratio` is 0 to 1 of the column maximum. */
export function InlineBar({ ratio, label }: { ratio: number; label: string }) {
  const w = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <svg viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label={label} className="h-2 w-full min-w-24">
      <rect width="100" height="8" className="fill-muted" />
      <rect width={w} height="8" className="fill-brand" />
    </svg>
  );
}

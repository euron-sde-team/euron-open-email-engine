import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import type { Paged } from "@open-email/types";

/** Cursor-paged list: pages accumulate under one key; changing the key (filters) starts over. */
export function useCursorList<T>(key: QueryKey, fetcher: (cursor: string | undefined) => Promise<Paged<T>>) {
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetcher(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (prev) => prev,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total;
  return {
    items,
    total,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error as Error | null,
    hasMore: Boolean(q.hasNextPage),
    loadingMore: q.isFetchingNextPage,
    fetchMore: () => void q.fetchNextPage(),
    refetch: () => void q.refetch(),
  };
}

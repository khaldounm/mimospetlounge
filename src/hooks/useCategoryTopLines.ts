"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/utils/api-client";
import type { ComparisonMode } from "@/utils/date-range";
import type { AnalyticsRange, CategoryTopLines } from "@/types/entities";

interface TopLinesState {
  data: CategoryTopLines | null;
  loading: boolean;
  error: string | null;
}

// The lines behind one category row, fetched when the dialog for that row
// mounts. The dialog remounts per open, so this runs once per look and never
// for a row nobody opens. State starts as "loading" rather than being reset
// inside the effect, since the inputs are fixed for the life of one mount; the
// request id still guards against an out-of-order reply if they ever change.
export function useCategoryTopLines(query: {
  group: string;
  category: string;
  range: AnalyticsRange;
  mode: ComparisonMode;
}): TopLinesState {
  const { group, category, range, mode } = query;
  const [data, setData] = useState<CategoryTopLines | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const requestId = ++latest.current;

    const params = new URLSearchParams({
      group,
      category,
      mode,
      from: range.from,
      to: range.to,
    });
    apiRequest<{ data: CategoryTopLines }>(
      `/api/analytics/categories/top?${params.toString()}`,
    )
      .then((res) => {
        if (requestId === latest.current) setData(res.data);
      })
      .catch((err: unknown) => {
        if (requestId === latest.current) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      })
      .finally(() => {
        if (requestId === latest.current) setLoading(false);
      });
  }, [group, category, mode, range.from, range.to]);

  return { data, loading, error };
}

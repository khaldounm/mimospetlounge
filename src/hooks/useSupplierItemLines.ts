"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/utils/api-client";
import type { SupplierItemOrder } from "@/constants/analytics";
import type { AnalyticsRange, SupplierItemLines } from "@/types/entities";

interface SupplierItemLinesState {
  data: SupplierItemLines | null;
  loading: boolean;
  error: string | null;
}

// One supplier's best or slowest sellers, fetched when the dialog for that
// list mounts. The dialog remounts per open, so this runs once per look and
// never for a list nobody opens. Same shape as useCategoryTopLines: state
// starts as "loading" since the inputs are fixed for the life of one mount,
// and the request id still guards against an out-of-order reply.
export function useSupplierItemLines(query: {
  supplierId: number;
  order: SupplierItemOrder;
  range: AnalyticsRange;
}): SupplierItemLinesState {
  const { supplierId, order, range } = query;
  const [data, setData] = useState<SupplierItemLines | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const requestId = ++latest.current;

    const params = new URLSearchParams({
      supplierId: String(supplierId),
      order,
      from: range.from,
      to: range.to,
    });
    apiRequest<{ data: SupplierItemLines }>(
      `/api/analytics/suppliers/items?${params.toString()}`,
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
  }, [supplierId, order, range.from, range.to]);

  return { data, loading, error };
}

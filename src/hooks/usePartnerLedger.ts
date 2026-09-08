"use client";

import { useCallback, useRef, useState } from "react";
import { apiRequest } from "@/utils/api-client";
import { rangeQuery } from "@/utils/date-range";
import { PARTNER_PAGE_SIZE } from "@/constants/partner";
import type { AnalyticsRange, PartnerPage } from "@/types/entities";

// Which ledger under a partner this is, which is also its route segment.
export type PartnerLedgerKind = "sales" | "payouts" | "items";

export interface PartnerLedger<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  /** Turn to a page. Only ever called while the section is open. */
  setPage: (page: number) => void;
  loading: boolean;
  error: string | null;
  /** A response has arrived, so an empty `rows` really means nothing matched. */
  loaded: boolean;
  /** Called when the section is expanded. Nothing is fetched before this. */
  open: () => void;
  /** The page's dates changed. Refetches only if this section is open. */
  setRange: (next: AnalyticsRange) => void;
  /** Refetch the current page after a write that changed it. */
  reload: () => void;
}

// One paginated ledger under a partner.
//
// Nothing is requested until the section is opened, and a section nobody opens
// costs nothing at all: that is the whole point of splitting the page up. Once
// open it follows the dates like the figures above it do, which is why the
// range arrives through `setRange` rather than being watched: a closed section
// records the new dates and stays silent until someone asks to see it.
//
// Event-driven throughout, like useAnalyticsSection, so a fetch is always
// traceable to something the reader did.
export function usePartnerLedger<T>(
  partnerId: number,
  kind: PartnerLedgerKind,
  initialRange: AnalyticsRange,
): PartnerLedger<T> {
  const [range, setRangeState] = useState(initialRange);
  const [page, setPageState] = useState(0);
  const [data, setData] = useState<PartnerPage<T> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  // Whether this section has ever been opened. Guards the range and reload
  // paths, which must stay silent for a section nobody has looked at.
  const started = useRef(false);

  const fetchPage = useCallback(
    (forRange: AnalyticsRange, forPage: number) => {
      started.current = true;
      const requestId = ++latest.current;
      setLoading(true);
      setError(null);

      const query = `${rangeQuery(forRange)}&page=${forPage}`;
      apiRequest<PartnerPage<T>>(`/api/partners/${partnerId}/${kind}?${query}`)
        .then((res) => {
          if (requestId === latest.current) setData(res);
        })
        .catch((err: unknown) => {
          if (requestId === latest.current) {
            setError(err instanceof Error ? err.message : "Failed to load");
          }
        })
        .finally(() => {
          if (requestId === latest.current) setLoading(false);
        });
    },
    [partnerId, kind],
  );

  const open = useCallback(() => {
    if (started.current) return;
    fetchPage(range, 0);
  }, [fetchPage, range]);

  const setPage = useCallback(
    (next: number) => {
      setPageState(next);
      fetchPage(range, next);
    },
    [fetchPage, range],
  );

  const setRange = useCallback(
    (next: AnalyticsRange) => {
      setRangeState(next);
      // New dates invalidate whatever page we were on: page 4 of last year's
      // sales is not page 4 of today's.
      setPageState(0);
      if (started.current) fetchPage(next, 0);
    },
    [fetchPage],
  );

  const reload = useCallback(() => {
    if (started.current) fetchPage(range, page);
  }, [fetchPage, range, page]);

  return {
    rows: data?.rows ?? [],
    total: data?.total ?? 0,
    page,
    pageSize: PARTNER_PAGE_SIZE,
    setPage,
    loading,
    error,
    loaded: data !== null,
    open,
    setRange,
    reload,
  };
}

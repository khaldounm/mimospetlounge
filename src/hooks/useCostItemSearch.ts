"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/utils/api-client";
import type { InventoryItemDTO } from "@/types/entities";

// What the cost builder needs of an item: enough to name it and to price it.
export interface CostItemOption {
  itemId: number;
  name: string;
  unit: string | null;
  lastCost: string | null;
  // Whether one is recorded at all: the only cost fact a non-admin gets.
  hasCost: boolean;
}

const DEBOUNCE_MS = 250;

// Type-to-search over stock for the service cost builder. Distinct from
// useItemSearch, which reads the analytics endpoint and deliberately returns no
// cost: pricing a recipe on screen needs lastCost, and /api/inventory is the
// endpoint that serves it, already stripped for anyone who may not see cost
// (see canSeeCost), in which case every option arrives with lastCost null.
//
// A request id guards against out-of-order responses, so a slow reply for a
// short prefix cannot overwrite the results for what was typed after it.
// `enabled` is what keeps a saved recipe from stampeding the endpoint. Each row
// owns a copy of this hook, so a service with five stock lines would otherwise
// fire five searches the moment the dialog opens, each of them looking up the
// name of an item that is ALREADY selected. Off until the field is actually
// used, which makes the common case (open a service, change the price, close)
// cost nothing at all.
export function useCostItemSearch(
  query: string,
  enabled = true,
): {
  options: CostItemOption[];
  loading: boolean;
} {
  const [options, setOptions] = useState<CostItemOption[]>([]);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const requestId = ++latest.current;
    const timer = setTimeout(() => {
      setLoading(true);
      void (async () => {
        try {
          const params = new URLSearchParams();
          const q = query.trim();
          if (q) params.set("q", q);
          const data = await apiRequest<{ items: InventoryItemDTO[] }>(
            `/api/inventory?${params}`,
          );
          if (requestId !== latest.current) return;
          setOptions(
            data.items.map((i) => ({
              itemId: i.itemId,
              name: i.name,
              unit: i.unit,
              lastCost: i.lastCost,
              hasCost: i.hasCost,
            })),
          );
        } catch {
          // A failed lookup empties the list but leaves the field usable.
          if (requestId === latest.current) setOptions([]);
        } finally {
          if (requestId === latest.current) setLoading(false);
        }
      })();
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, enabled]);

  return { options, loading };
}

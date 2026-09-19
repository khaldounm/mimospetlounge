"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/utils/api-client";
import type { UpcomingBirthdays } from "@/types/entities";

interface BirthdaysState {
  data: UpcomingBirthdays | null;
  loading: boolean;
  error: string | null;
  /** Ticks a pet off the list or puts it back, on the server and in place. */
  setSeen: (patientId: number, seen: boolean) => Promise<void>;
}

// The upcoming-birthdays list, fetched when the dialog mounts. The dialog
// remounts per open, so nothing is fetched for a page nobody opens the list
// on. State starts as loading rather than being reset in the effect; the
// request id guards a late reply if the component is torn down and remounted
// quickly.
export function useUpcomingBirthdays(): BirthdaysState {
  const [data, setData] = useState<UpcomingBirthdays | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const requestId = ++latest.current;
    apiRequest<UpcomingBirthdays>("/api/patients/birthdays")
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
  }, []);

  // Optimistic: the row flips at once and flips back if the server refuses,
  // so ticking down a list of ten does not wait on ten round trips.
  const setSeen = useCallback(async (patientId: number, seen: boolean) => {
    const flip = (value: boolean) =>
      setData((prev) =>
        prev
          ? {
              ...prev,
              patients: prev.patients.map((p) =>
                p.patientId === patientId ? { ...p, seen: value } : p,
              ),
            }
          : prev,
      );
    flip(seen);
    try {
      await apiRequest(`/api/patients/${patientId}/birthday`, {
        method: "PATCH",
        body: { seen },
      });
    } catch (err) {
      flip(!seen);
      throw err;
    }
  }, []);

  return { data, loading, error, setSeen };
}

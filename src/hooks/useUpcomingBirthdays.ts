"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/utils/api-client";
import type {
  NotificationDTO,
  UpcomingBirthdayDTO,
  UpcomingBirthdays,
} from "@/types/entities";

interface BirthdaysState {
  data: UpcomingBirthdays | null;
  loading: boolean;
  error: string | null;
  /** Ticks a pet off the list or puts it back, on the server and in place. */
  setSeen: (patientId: number, seen: boolean) => Promise<void>;
  /**
   * Re-renders every preview with another birthday template. The list is
   * fetched again rather than rendered here, so the preview stays the text
   * the server will actually send.
   */
  setTemplate: (templateId: number) => void;
  /**
   * Sends one pet its wishes, with an edited text when given, and settles the
   * row from the server's answer. Resolves to the notification as the server
   * left it: Sent, or Failed with the reason on it.
   */
  send: (patientId: number, body?: string) => Promise<NotificationDTO>;
}

// The upcoming-birthdays list, fetched when the dialog mounts. The dialog
// remounts per open, so nothing is fetched for a page nobody opens the list
// on. State starts as loading rather than being reset in the effect; the
// request id guards a late reply if the component is torn down and remounted
// quickly, or a template switch overtakes the load before it.
export function useUpcomingBirthdays(): BirthdaysState {
  const [data, setData] = useState<UpcomingBirthdays | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // undefined until the first answer names the template it rendered with.
  const [templateId, setTemplateId] = useState<number | undefined>(undefined);
  const latest = useRef(0);

  useEffect(() => {
    const requestId = ++latest.current;
    const query = templateId !== undefined ? `?templateId=${templateId}` : "";
    apiRequest<UpcomingBirthdays>(`/api/patients/birthdays${query}`)
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
  }, [templateId]);

  const patchRow = useCallback(
    (patientId: number, patch: Partial<UpcomingBirthdayDTO>) =>
      setData((prev) =>
        prev
          ? {
              ...prev,
              patients: prev.patients.map((p) =>
                p.patientId === patientId ? { ...p, ...patch } : p,
              ),
            }
          : prev,
      ),
    [],
  );

  // Optimistic: the row flips at once and flips back if the server refuses,
  // so ticking down a list of ten does not wait on ten round trips.
  const setSeen = useCallback(
    async (patientId: number, seen: boolean) => {
      patchRow(patientId, { seen });
      try {
        await apiRequest(`/api/patients/${patientId}/birthday`, {
          method: "PATCH",
          body: { seen },
        });
      } catch (err) {
        patchRow(patientId, { seen: !seen });
        throw err;
      }
    },
    [patchRow],
  );

  const setTemplate = useCallback((id: number) => {
    setError(null);
    setTemplateId(id);
  }, []);

  // Not optimistic: a send either happened or did not, and the row should
  // say which. The server's answer carries the status, the time and any
  // reason; a send that went through also ticked the pet, so the row ticks.
  // Sent with the template the previews were rendered with, so what goes out
  // is what was on screen.
  const renderedWith = data?.templateId ?? undefined;
  const send = useCallback(
    async (patientId: number, body?: string) => {
      const res = await apiRequest<{ notification: NotificationDTO }>(
        `/api/patients/${patientId}/birthday`,
        {
          method: "POST",
          body: {
            ...(renderedWith !== undefined ? { templateId: renderedWith } : {}),
            ...(body ? { body } : {}),
          },
        },
      );
      const n = res.notification;
      const sent = n.status === "Sent" || n.status === "Delivered";
      patchRow(patientId, {
        wishes: {
          notificationId: n.notificationId,
          status: n.status,
          sentAt: n.sentAt,
          errorMessage: n.errorMessage,
        },
        ...(sent ? { seen: true } : {}),
      });
      return n;
    },
    [patchRow, renderedWith],
  );

  return { data, loading, error, setSeen, setTemplate, send };
}

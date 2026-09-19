"use client";

import { useEffect, useRef } from "react";
import { INVENTORY_CHANGES_CHANNEL } from "@/constants/inventory";

// Which tab a notice came from. Module scope, so there is one per loaded page.
const TAB_ID = Math.random().toString(36).slice(2);

interface InventoryChange {
  itemId: number;
  from: string;
}

/**
 * Tells every other open tab that an inventory item was saved or its stock
 * moved.
 *
 * The order page and the receiving dialog link each line's item to its own
 * page in a NEW tab: the clinic is mid-delivery when it finds a barcode
 * missing or a pack size wrong, and wants the delivery still on screen when it
 * comes back. Fixing the item in the second tab did nothing to the first; this
 * is what tells it. A BroadcastChannel reaches every tab on the origin and
 * costs nothing while no item changes, which refetching on every return to the
 * tab would not: the counter alt-tabs to WhatsApp all day.
 *
 * Fire and forget. In a browser without BroadcastChannel nothing is sent and
 * the other tab is as stale as it always was.
 */
export function announceInventoryChange(itemId: number): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(INVENTORY_CHANGES_CHANNEL);
  channel.postMessage({ itemId, from: TAB_ID } satisfies InventoryChange);
  // postMessage has already queued the delivery; closing only releases the port.
  channel.close();
}

/**
 * Runs `onChange` whenever ANOTHER tab announces an inventory change.
 *
 * A notice from this tab is ignored: whatever saved the item here has already
 * put the result on screen, and a refetch racing behind it could put an older
 * copy back. The latest callback is always the one called, so the channel is
 * opened once and callers can pass an inline function.
 */
export function useInventoryChanges(
  onChange: (change: { itemId: number }) => void,
): void {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(INVENTORY_CHANGES_CHANNEL);
    channel.onmessage = (event: MessageEvent<InventoryChange>) => {
      if (event.data?.from === TAB_ID) return;
      latest.current({ itemId: event.data.itemId });
    };
    return () => channel.close();
  }, []);
}

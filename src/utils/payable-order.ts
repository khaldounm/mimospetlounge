import { formatDate, formatMoney } from "@/utils/format";
import type { PayableOrderOption } from "@/types/entities";

// How a bill reads in the "settling which bill?" pickers. A bill nothing has
// been put against shows its total; one part-paid shows what is left of it, so
// the amount on offer is the one that closes the bill rather than the one that
// overpays it.
export function payableOrderLabel(o: PayableOrderOption): string {
  const name = o.reference || `Order #${o.orderId}`;
  const money =
    Number(o.paid) > 0
      ? `${formatMoney(o.outstanding)} left of ${formatMoney(o.total)}`
      : formatMoney(o.total);
  const when = o.receivedOn ? ` \u00b7 ${formatDate(o.receivedOn)}` : "";
  return `${name} \u00b7 ${money}${when}`;
}

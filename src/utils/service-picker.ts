import { recordTypeForCategory } from "@/constants/clinical";
import type { ServicePickerOption } from "@/types/entities";
import type { RecordType } from "@/types/enums";

export interface GroupedServiceOptions {
  // Services whose category maps to this record type. The record type dictates
  // the list: a service belonging to another type is not offered here at all.
  matching: ServicePickerOption[];
  // Services whose category the map has never heard of, plus uncategorised ones.
  // These belong to no record type, so hiding them everywhere would make them
  // unreachable the way the old `category === recordType` filter did. They are
  // offered under every type, and only when there are any, so the normal case is
  // exactly the category's own services and nothing else.
  unfiled: ServicePickerOption[];
}

// Splits the catalogue for one record type. Unlike the previous ranking, this
// filters: choosing Grooming offers grooming services, not the whole catalogue
// with grooming on top.
export function groupServicesForRecordType(
  services: ServicePickerOption[],
  recordType: RecordType,
): GroupedServiceOptions {
  const matching: ServicePickerOption[] = [];
  const unfiled: ServicePickerOption[] = [];
  for (const service of services) {
    const mapped = recordTypeForCategory(service.category);
    if (mapped === recordType) matching.push(service);
    else if (mapped === null) unfiled.push(service);
  }
  return { matching, unfiled };
}

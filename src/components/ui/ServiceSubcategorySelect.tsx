"use client";

import { ListSubheader, MenuItem, TextField } from "@mui/material";
import { groupServicesForRecordType } from "@/utils/service-picker";
import type { ServicePickerOption } from "@/types/entities";
import type { RecordType } from "@/types/enums";

// Sentinel for "this was not one of our services". Never stored: callers turn it
// into an undefined subcategory and let the vet type a free title.
export const CUSTOM_SUBCATEGORY = "__other__";

interface Props {
  label: string;
  value: string;
  recordType: RecordType;
  services: ServicePickerOption[];
  onChange: (value: string) => void;
  helperText?: string;
}

// The record type dictates this list: only services whose category maps to it.
// The one exception is services in a category the map does not know, which
// belong to no type and would otherwise be unreachable everywhere; they trail
// under "Unfiled services" and only when some exist.
export default function ServiceSubcategorySelect({
  label,
  value,
  recordType,
  services,
  onChange,
  helperText,
}: Props) {
  const { matching, unfiled } = groupServicesForRecordType(
    services,
    recordType,
  );

  // Headings only earn their place when there are two groups to tell apart.
  const showHeadings = matching.length > 0 && unfiled.length > 0;

  return (
    <TextField
      select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      helperText={helperText}
      fullWidth
    >
      {showHeadings && <ListSubheader>{recordType}</ListSubheader>}
      {matching.map((s) => (
        <MenuItem key={s.serviceId} value={s.name}>
          {s.name}
        </MenuItem>
      ))}
      {showHeadings && <ListSubheader>Unfiled services</ListSubheader>}
      {unfiled.map((s) => (
        <MenuItem key={s.serviceId} value={s.name}>
          {s.name}
        </MenuItem>
      ))}
      <MenuItem value={CUSTOM_SUBCATEGORY}>Other / custom</MenuItem>
    </TextField>
  );
}

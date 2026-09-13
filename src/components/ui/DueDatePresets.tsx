"use client";

import { Chip, Stack, Typography } from "@mui/material";
import { NEXT_DUE_PRESETS } from "@/constants/clinical";
import { isDateInput, shiftLocalDate } from "@/utils/date-range";

interface Props {
  /** "YYYY-MM-DD" the intervals count from. */
  performedAt: string;
  value: string;
  onChange: (value: string) => void;
  /** Trails the chips: what setting the date does, e.g. the recall it raises. */
  hint?: string;
}

// The usual recall intervals as one click each, counted from the performed
// date. The chip matching the date in the field is filled, so "+1 yr" reads
// back as the choice it was; clicking it again clears the date.
export default function DueDatePresets({
  performedAt,
  value,
  onChange,
  hint,
}: Props) {
  const ready = isDateInput(performedAt);
  return (
    <Stack
      direction="row"
      spacing={0.75}
      useFlexGap
      sx={{ flexWrap: "wrap", alignItems: "center" }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
        Next due
      </Typography>
      {NEXT_DUE_PRESETS.map((preset) => {
        const date = ready ? shiftLocalDate(performedAt, preset) : "";
        const active = date !== "" && date === value;
        return (
          <Chip
            key={preset.label}
            label={preset.label}
            size="small"
            variant={active ? "filled" : "outlined"}
            color={active ? "primary" : "default"}
            disabled={!ready}
            onClick={() => onChange(active ? "" : date)}
          />
        );
      })}
      {hint && (
        <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
          {hint}
        </Typography>
      )}
    </Stack>
  );
}

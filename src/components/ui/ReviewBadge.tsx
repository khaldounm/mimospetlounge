"use client";

import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";

// Marks a row that came out of the old Access system with something a human
// should confirm: a pet name the import could not split confidently, a price
// the old file never recorded, an invoice whose lines do not quite add up.
//
// The note explains what to check. Without it the badge would tell staff a row
// is wrong but not why, which is worse than not flagging it at all.
export default function ReviewBadge({
  needsReview,
  note,
  size = "small",
  label = "Check",
}: {
  needsReview?: boolean;
  note?: string | null;
  size?: "small" | "medium";
  // Most flags mean "somebody go and fix this". A few mean a settled state the
  // counter has to know about, and "Check" reads as a task nobody can close.
  label?: string;
}) {
  if (!needsReview) return null;

  const chip = (
    <Chip
      label={label}
      color="error"
      size={size}
      variant="outlined"
      // Sits next to a name or a number, so it must not out-shout it.
      sx={{
        ml: 0.75,
        height: 20,
        fontSize: "0.6875rem",
        fontWeight: 600,
        verticalAlign: "middle",
        "& .MuiChip-label": { px: 0.75 },
      }}
    />
  );

  return note ? (
    <Tooltip title={note} arrow enterTouchDelay={0}>
      {/* Tooltip needs a focusable child for keyboard and touch users. */}
      <span tabIndex={0}>{chip}</span>
    </Tooltip>
  ) : (
    chip
  );
}

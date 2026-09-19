"use client";

import {
  Alert,
  Box,
  CircularProgress,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  Fade,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useCategoryTopLines } from "@/hooks/useCategoryTopLines";
import {
  formatRangeLabel,
  priorRange,
  type ComparisonMode,
} from "@/utils/date-range";
import { CATEGORY_TOP_LIMIT } from "@/constants/analytics";
import { DeltaChip, money } from "./AnalyticsPrimitives";
import type { AnalyticsRange } from "@/types/entities";

export interface CategoryTopTarget {
  group: string;
  groupLabel: string;
  category: string;
}

// What the dialog reserves for the table while it loads: about eight rows, so
// the common case unrolls into space already on screen rather than growing
// the dialog from a strip. Let go once the table is in, with a transition, so
// a category with two lines does not sit above a blank band.
const LOADING_STAGE_HEIGHT = 320;

// The bar column. Set as a minimum as well as a width: the name column takes
// every spare pixel, and a plain width on this one was squeezed to half.
const SHARE_COLUMN_WIDTH = 225;

// A line's weight in the list as a progress bar: filled in proportion to the
// top line, so the ranking reads at a glance, with the line's share of the
// whole category printed over the middle of the bar. Two scales on purpose: a
// bar filled to the category share would make the top line a sliver in a
// category of two hundred products, and say nothing.
//
// Green, the same as a growth chip: this is a positive quantity. Square at
// the start and barely rounded at the end, so the bars read as one aligned
// column rather than a stack of pills.
function ShareBar({
  value,
  max,
  share,
}: {
  // How far the bar fills, against `max`. Null draws an empty track.
  value: number | null;
  max: number;
  // What the label says. Null shows no label.
  share: number | null;
}) {
  const width =
    value !== null && max > 0 && value > 0
      ? Math.min(Math.max((value / max) * 100, 2), 100)
      : 0;
  return (
    <Box
      sx={{
        position: "relative",
        height: 20,
        borderRadius: "0 3px 3px 0",
        bgcolor: "action.hover",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          width: `${width}%`,
          height: "100%",
          borderRadius: "0 3px 3px 0",
          bgcolor: "success.main",
          opacity: 0.4,
          transition: "width 350ms ease",
        }}
      />
      {share !== null && (
        <Typography
          variant="caption"
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // The label sits on the track as often as on the fill, so it
            // takes the green that contrasts with the page: the dark shade
            // on cream, the light shade on a near-black ground, where the
            // dark shade vanished.
            color: (t) =>
              t.palette.mode === "dark"
                ? t.palette.success.light
                : t.palette.success.dark,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {`${Math.round(share)}%`}
        </Typography>
      )}
    </Box>
  );
}

interface Props {
  // Null closes the dialog. Passing the target rather than an `open` flag
  // keeps the row and its dialog in one piece of state on the section.
  target: CategoryTopTarget | null;
  range: AnalyticsRange;
  mode: ComparisonMode;
  onClose: () => void;
}

// What is behind one row of the category table: its best-billing lines over
// the same range, against the same comparison window. Opened on demand from
// the row, fetched on open, and remounted per open so nothing is held for a
// row nobody is looking at.
export default function CategoryTopDialog({
  target,
  range,
  mode,
  onClose,
}: Props) {
  return (
    // Wide: eight columns, and the product names are long. At md the name
    // column was squeezed to a third of its width and every row wrapped to a
    // different height.
    <Dialog open={target !== null} onClose={onClose} fullWidth maxWidth="lg">
      {target && (
        <TopLines target={target} range={range} mode={mode} onClose={onClose} />
      )}
    </Dialog>
  );
}

function TopLines({
  target,
  range,
  mode,
  onClose,
}: Omit<Props, "target"> & { target: CategoryTopTarget }) {
  const { data, loading, error } = useCategoryTopLines({
    group: target.group,
    category: target.category,
    range,
    mode,
  });

  // The top line sets the scale every bar is drawn against.
  const maxCurrent = data
    ? data.lines.reduce((max, l) => Math.max(max, l.current), 0)
    : 0;

  // How much of the row the list accounts for. On a category with fewer lines
  // than the cap that is all of it and the note is skipped.
  const listed = data?.lines.reduce((sum, l) => sum + l.current, 0) ?? 0;
  const capped = (data?.lines.length ?? 0) >= CATEGORY_TOP_LIMIT;
  const share =
    data && capped && data.total.current > 0
      ? Math.round((listed / data.total.current) * 100)
      : null;

  return (
    <>
      <DialogTitle sx={{ pr: 6 }}>
        {target.category}
        <Typography
          component="span"
          variant="body2"
          color="text.secondary"
          sx={{ ml: 1 }}
        >
          {target.groupLabel}
        </Typography>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {/* The comparison window is worked out here rather than read off the
            reply, so this line is complete before the data lands and never
            reflows under it. */}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Top {CATEGORY_TOP_LIMIT} by billed revenue, {formatRangeLabel(range)}{" "}
          against {formatRangeLabel(priorRange(range, mode))}.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {error}
          </Alert>
        )}

        {/* A fixed-height stage while loading, so the dialog opens at a
            steady size instead of as a strip that jumps when the rows land.
            The table then unrolls into it: Collapse animates the height from
            nothing to the table's own, and past the stage's minimum the
            dialog grows with it. */}
        <Box
          sx={{
            position: "relative",
            minHeight: loading ? LOADING_STAGE_HEIGHT : 0,
            transition: "min-height 350ms ease",
          }}
        >
          <Fade in={loading} unmountOnExit timeout={{ enter: 0, exit: 200 }}>
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CircularProgress size={36} />
            </Box>
          </Fade>

          <Collapse in={!loading && data !== null} timeout={350}>
            {data && data.lines.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 3 }} align="center">
                Nothing billed in this category over the period.
              </Typography>
            ) : (
              <Box sx={{ overflowX: "auto" }}>
                <Table
                  size="small"
                  // The header stays put while the list scrolls under it.
                  stickyHeader
                  sx={{
                    // Money and units line up digit for digit down a column.
                    fontVariantNumeric: "tabular-nums",
                    // One line per row, every row the same height. A name
                    // too long for its column is cut with an ellipsis and
                    // carried whole in the cell's tooltip, never wrapped.
                    "& .MuiTableCell-root": {
                      fontVariantNumeric: "inherit",
                      whiteSpace: "nowrap",
                    },
                  }}
                >
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 40 }}>#</TableCell>
                      <TableCell>Line</TableCell>
                      <TableCell align="right">Units</TableCell>
                      <TableCell
                        sx={{
                          width: SHARE_COLUMN_WIDTH,
                          minWidth: SHARE_COLUMN_WIDTH,
                        }}
                      >
                        Share
                      </TableCell>
                      <TableCell align="right">This period</TableCell>
                      <TableCell align="right">Comparison</TableCell>
                      <TableCell align="right">Change</TableCell>
                      <TableCell align="right">%</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(data?.lines ?? []).map((line, index) => (
                      <TableRow
                        key={line.label}
                        hover
                        // Banded, so a figure can be carried across seven
                        // columns without losing its line. Set on the row
                        // rather than by an nth-child rule, which would
                        // outrank the hover tint.
                        sx={{
                          backgroundColor:
                            index % 2 === 1 ? "action.hover" : undefined,
                        }}
                      >
                        <TableCell sx={{ color: "text.secondary" }}>
                          {index + 1}
                        </TableCell>
                        {/* width 100% with maxWidth 0 is what makes a table
                            cell take the slack AND truncate instead of
                            stretching the table to fit the longest name. */}
                        <TableCell
                          title={line.label}
                          sx={{
                            width: "100%",
                            maxWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {line.label}
                        </TableCell>
                        <TableCell align="right">
                          {line.units === null ? "-" : line.units}
                        </TableCell>
                        <TableCell
                          sx={{
                            width: SHARE_COLUMN_WIDTH,
                            minWidth: SHARE_COLUMN_WIDTH,
                          }}
                        >
                          <ShareBar
                            value={line.current}
                            max={maxCurrent}
                            share={
                              data && data.total.current > 0
                                ? (line.current / data.total.current) * 100
                                : null
                            }
                          />
                        </TableCell>
                        <TableCell align="right">
                          {money(line.current)}
                        </TableCell>
                        <TableCell align="right">{money(line.prior)}</TableCell>
                        <TableCell align="right">{money(line.delta)}</TableCell>
                        <TableCell align="right">
                          <DeltaChip
                            delta={line.delta}
                            prior={line.prior}
                            percent={line.percent}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                    {data && (
                      <TableRow
                        sx={{
                          // A rule rather than a tint: the total reads as
                          // the line the list adds up under, not as one
                          // more line of it.
                          "& .MuiTableCell-root": {
                            borderTop: 2,
                            borderTopColor: "divider",
                            borderBottom: 0,
                            fontWeight: 700,
                          },
                        }}
                      >
                        <TableCell />
                        <TableCell>Whole category</TableCell>
                        <TableCell />
                        <TableCell sx={{ minWidth: SHARE_COLUMN_WIDTH }}>
                          <ShareBar
                            value={maxCurrent}
                            max={maxCurrent}
                            share={100}
                          />
                        </TableCell>
                        <TableCell align="right">
                          {money(data.total.current)}
                        </TableCell>
                        <TableCell align="right">
                          {money(data.total.prior)}
                        </TableCell>
                        <TableCell align="right">
                          {money(data.total.delta)}
                        </TableCell>
                        <TableCell align="right">
                          <DeltaChip
                            delta={data.total.delta}
                            prior={data.total.prior}
                            percent={data.total.percent}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {share !== null && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 1 }}
                  >
                    These {data!.lines.length} lines are {share}% of the
                    category.
                  </Typography>
                )}
              </Box>
            )}
          </Collapse>
        </Box>
      </DialogContent>
    </>
  );
}

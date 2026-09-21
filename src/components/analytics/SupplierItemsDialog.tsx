"use client";

import { useState } from "react";
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
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import { useSupplierItemLines } from "@/hooks/useSupplierItemLines";
import {
  SUPPLIER_ITEM_ORDER_LABELS,
  type SupplierItemOrder,
} from "@/constants/analytics";
import {
  supplierItemsCaption,
  supplierItemsFileName,
  supplierItemsNote,
  unitShare,
} from "@/utils/supplier-items";
import { SHARE_COLUMN_WIDTH, ShareBar, money } from "./AnalyticsPrimitives";
import type {
  AnalyticsRange,
  SupplierItemLines,
  SupplierOption,
} from "@/types/entities";

export interface SupplierItemsTarget {
  supplier: SupplierOption;
  order: SupplierItemOrder;
}

// What the dialog reserves for the table while it loads: about eight rows, so
// the common case unrolls into space already on screen rather than growing
// the dialog from a strip. Let go once the table is in, with a transition.
const LOADING_STAGE_HEIGHT = 320;

interface Props {
  // Null closes the dialog. Passing the target rather than an `open` flag
  // keeps the picker and its dialog in one piece of state on the section.
  target: SupplierItemsTarget | null;
  range: AnalyticsRange;
  onClose: () => void;
}

// Saves the list as a one-page PDF, built here in the browser from the rows
// already on screen: the renderer and the document are loaded on demand, the
// server is not asked for anything, and the file is exactly what was looked
// at. The icon reports its own failure rather than an alert, since the list
// under it is fine.
function DownloadPdf({
  target,
  range,
  data,
}: {
  target: SupplierItemsTarget;
  range: AnalyticsRange;
  data: SupplierItemLines | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = "Download as PDF";

  async function download() {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const [{ pdf }, { default: SupplierItemsPdfDocument }] =
        await Promise.all([
          import("@react-pdf/renderer"),
          import("./SupplierItemsPdfDocument"),
        ]);
      const blob = await pdf(
        <SupplierItemsPdfDocument
          supplier={target.supplier}
          order={target.order}
          range={range}
          data={data}
          generatedAt={new Date().toISOString()}
        />,
      ).toBlob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = supplierItemsFileName(
        target.supplier,
        target.order,
        range,
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build the PDF");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tooltip title={error ?? title}>
      {/* A disabled button fires no events, so the tooltip needs a wrapper
          that can still be hovered. */}
      <span>
        <IconButton
          aria-label={title}
          color={error ? "error" : "default"}
          disabled={!data || data.lines.length === 0 || busy}
          onClick={() => void download()}
        >
          {busy ? <CircularProgress size={20} /> : <DownloadIcon />}
        </IconButton>
      </span>
    </Tooltip>
  );
}

// One supplier's products ranked on units sold over the section's range: the
// fifteen that moved most, or the fifteen that moved least. Opened from the
// purchases section, fetched on open, and remounted per open so nothing is
// held for a list nobody is looking at. Fifteen rows and four totals arrive;
// every share on screen is worked out here from those.
export default function SupplierItemsDialog({ target, range, onClose }: Props) {
  return (
    // Wide enough for the product names, which are long, without the spread
    // the eight-column category dialog needs.
    <Dialog open={target !== null} onClose={onClose} fullWidth maxWidth="md">
      {target && <ItemLines target={target} range={range} onClose={onClose} />}
    </Dialog>
  );
}

function ItemLines({
  target,
  range,
  onClose,
}: Omit<Props, "target"> & { target: SupplierItemsTarget }) {
  const { data, loading, error } = useSupplierItemLines({
    supplierId: target.supplier.supplierId,
    order: target.order,
    range,
  });

  // Every bar is drawn against the supplier's best seller, whichever list
  // this is, so the slow sellers read as the slivers they are rather than
  // filling their own column.
  const maxUnits = data?.total.maxUnits ?? 0;
  const note = data ? supplierItemsNote(data) : null;

  return (
    <>
      <DialogTitle sx={{ pr: 12 }}>
        {target.supplier.name}
        <Typography
          component="span"
          variant="body2"
          color="text.secondary"
          sx={{ ml: 1 }}
        >
          {SUPPLIER_ITEM_ORDER_LABELS[target.order]}
        </Typography>
        <Box sx={{ position: "absolute", right: 8, top: 8 }}>
          <DownloadPdf target={target} range={range} data={data} />
          <IconButton aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {supplierItemsCaption(target.order, range)}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {error}
          </Alert>
        )}

        {/* A fixed-height stage while loading, so the dialog opens at a
            steady size instead of as a strip that jumps when the rows land.
            The table then unrolls into it. */}
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
                None of this supplier&apos;s products sold over the period.
                {data.unsoldItems > 0 &&
                  ` It has ${data.unsoldItems} on the books.`}
              </Typography>
            ) : (
              <Box sx={{ overflowX: "auto" }}>
                <Table
                  size="small"
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
                      <TableCell>Product</TableCell>
                      <TableCell align="right">Units</TableCell>
                      <TableCell
                        sx={{
                          width: SHARE_COLUMN_WIDTH,
                          minWidth: SHARE_COLUMN_WIDTH,
                        }}
                      >
                        Share
                      </TableCell>
                      <TableCell align="right">Billed</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(data?.lines ?? []).map((line, index) => (
                      <TableRow
                        key={line.itemId}
                        hover
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
                          title={line.name}
                          sx={{
                            width: "100%",
                            maxWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {line.name}
                        </TableCell>
                        <TableCell align="right">{line.units}</TableCell>
                        <TableCell
                          sx={{
                            width: SHARE_COLUMN_WIDTH,
                            minWidth: SHARE_COLUMN_WIDTH,
                          }}
                        >
                          <ShareBar
                            value={line.units}
                            max={maxUnits}
                            share={data ? unitShare(data, line.units) : null}
                          />
                        </TableCell>
                        <TableCell align="right">
                          {money(line.revenue)}
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
                        <TableCell>
                          All {data.total.items} products that sold
                        </TableCell>
                        <TableCell align="right">{data.total.units}</TableCell>
                        <TableCell sx={{ minWidth: SHARE_COLUMN_WIDTH }}>
                          <ShareBar
                            value={maxUnits}
                            max={maxUnits}
                            share={100}
                          />
                        </TableCell>
                        <TableCell align="right">
                          {money(data.total.revenue)}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {note && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 1 }}
                  >
                    {note}
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

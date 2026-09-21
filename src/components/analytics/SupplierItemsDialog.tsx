"use client";

import { Fragment, useState } from "react";
import {
  Alert,
  Box,
  ButtonBase,
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
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { useSupplierItemLines } from "@/hooks/useSupplierItemLines";
import {
  SUPPLIER_ITEM_ORDER_LABELS,
  SUPPLIER_ITEM_VIEWS,
  SUPPLIER_ITEM_VIEW_LABELS,
  type SupplierItemOrder,
  type SupplierItemView,
} from "@/constants/analytics";
import { formatShare, formatUnits } from "@/utils/format";
import {
  categoryNote,
  flatLines,
  flatNote,
  shareOf,
  soldSummary,
  supplierItemsCaption,
  supplierItemsFileName,
  supplierMaxUnits,
  supplierNote,
  supplierTotals,
} from "@/utils/supplier-items";
import { SHARE_COLUMN_WIDTH, ShareBar, money } from "./AnalyticsPrimitives";
import type {
  AnalyticsRange,
  SupplierItemCategory,
  SupplierItemLine,
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

// The tile that shows every category at once. The empty string can never be
// a category: a product with none is filed under a named label by the query.
const ALL_CATEGORIES = "";

interface Props {
  // Null closes the dialog. Passing the target rather than an `open` flag
  // keeps the picker and its dialog in one piece of state on the section.
  target: SupplierItemsTarget | null;
  range: AnalyticsRange;
  onClose: () => void;
}

// Saves the report as a PDF laid out the way it is showing (every category,
// or the one flat list), built here in the browser from the rows already on
// screen: the renderer and the document are loaded on demand, the server is
// not asked for anything, and the file is exactly what was looked at. The
// icon reports its own failure rather than an alert, since the list under it
// is fine.
function DownloadPdf({
  target,
  view,
  range,
  data,
}: {
  target: SupplierItemsTarget;
  view: SupplierItemView;
  range: AnalyticsRange;
  data: SupplierItemLines | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = `Download as PDF, ${SUPPLIER_ITEM_VIEW_LABELS[view].toLowerCase()}`;

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
          view={view}
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
        view,
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
          disabled={!data || data.categories.length === 0 || busy}
          onClick={() => void download()}
        >
          {busy ? <CircularProgress size={20} /> : <DownloadIcon />}
        </IconButton>
      </span>
    </Tooltip>
  );
}

// One pill per category, and one for all of them. The pill is the bar: its
// background fills to the category's share of the supplier, with the name
// and the figure printed over it, so the row of pills is the overview and
// nothing else is needed above the table. Picking one puts its list under
// them, on the spot, since every category came with the one reply. The whole
// pill is the button; the eye says what a click does rather than being a
// second control, so no button nests in another.
function CategoryPill({
  label,
  share,
  selected,
  onSelect,
}: {
  label: string;
  share: number | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const fill = share === null ? 0 : Math.min(Math.max(share, 0), 100);
  return (
    <ButtonBase
      onClick={onSelect}
      aria-pressed={selected}
      sx={(t) => ({
        position: "relative",
        overflow: "hidden",
        height: 32,
        px: 1.5,
        gap: 0.75,
        borderRadius: 16,
        border: 1,
        borderColor: selected ? "primary.main" : "divider",
        // The selected pill's edge is drawn twice as heavy without moving
        // its neighbours by a pixel.
        boxShadow: selected ? `inset 0 0 0 1px ${t.palette.primary.main}` : 0,
        bgcolor: "background.paper",
        fontSize: t.typography.body2.fontSize,
        transition: t.transitions.create(["border-color", "box-shadow"], {
          duration: t.transitions.duration.shorter,
        }),
        "&:hover": {
          borderColor: selected ? "primary.main" : "text.secondary",
        },
        "&.Mui-focusVisible": {
          outline: `2px solid ${t.palette.primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      {/* The fill, under the text. Same green as every share bar on the
          page, at a tint the text stays readable on in both themes. */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          width: `${fill}%`,
          bgcolor: "success.main",
          opacity: 0.28,
          transition: "width 350ms ease",
        }}
      />
      <Box
        component="span"
        sx={{ position: "relative", fontWeight: selected ? 700 : 500 }}
      >
        {label}
      </Box>
      <Box
        component="span"
        sx={{
          position: "relative",
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: (t) =>
            t.palette.mode === "dark"
              ? t.palette.success.light
              : t.palette.success.dark,
        }}
      >
        {share === null ? "-" : formatShare(share)}
      </Box>
      {selected ? (
        <VisibilityIcon
          fontSize="inherit"
          color="primary"
          sx={{ position: "relative" }}
        />
      ) : (
        <VisibilityOutlinedIcon
          fontSize="inherit"
          sx={{ position: "relative", color: "text.secondary" }}
        />
      )}
    </ButtonBase>
  );
}

function CategoryPills({
  categories,
  totals,
  value,
  onChange,
}: {
  categories: SupplierItemCategory[];
  totals: ReturnType<typeof supplierTotals>;
  value: string;
  onChange: (category: string) => void;
}) {
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 2 }}>
      {categories.map((c) => (
        <CategoryPill
          key={c.category}
          label={c.category}
          share={shareOf(c.total.units, totals.units)}
          selected={value === c.category}
          onSelect={() => onChange(c.category)}
        />
      ))}
      <CategoryPill
        label="All categories"
        share={totals.units > 0 ? 100 : null}
        selected={value === ALL_CATEGORIES}
        onSelect={() => onChange(ALL_CATEGORIES)}
      />
    </Box>
  );
}

// One supplier's products ranked on units sold over the section's range,
// grouped under their categories: the fifteen that moved most in each, or the
// fifteen that moved least. Opened from the purchases section, fetched on
// open, and remounted per open so nothing is held for a list nobody is
// looking at. Per-category rows and totals arrive; every share on screen and
// the supplier-wide line are worked out here from those.
export default function SupplierItemsDialog({ target, range, onClose }: Props) {
  return (
    // Wide enough for the product names, which are long, without the spread
    // the eight-column category dialog needs.
    <Dialog open={target !== null} onClose={onClose} fullWidth maxWidth="md">
      {target && <ItemLines target={target} range={range} onClose={onClose} />}
    </Dialog>
  );
}

// The ranked rows of one list, whichever list it is: a bar filled against
// the best seller of the group and a share of the group's units, where the
// group is a category or the whole supplier.
function LineRows({
  lines,
  maxUnits,
  wholeUnits,
}: {
  lines: SupplierItemLine[];
  maxUnits: number;
  wholeUnits: number;
}) {
  return lines.map((line, index) => (
    <TableRow
      key={line.itemId}
      hover
      // Banded, so a figure can be carried across the columns without
      // losing its line. Set on the row rather than by an nth-child rule,
      // which would outrank the hover tint.
      sx={{ backgroundColor: index % 2 === 1 ? "action.hover" : undefined }}
    >
      <TableCell sx={{ color: "text.secondary" }}>{index + 1}</TableCell>
      {/* width 100% with maxWidth 0 is what makes a table cell take the
          slack AND truncate instead of stretching the table to fit the
          longest name. */}
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
      <TableCell align="right">{formatUnits(line.units)}</TableCell>
      <TableCell
        sx={{ width: SHARE_COLUMN_WIDTH, minWidth: SHARE_COLUMN_WIDTH }}
      >
        <ShareBar
          value={line.units}
          max={maxUnits}
          share={shareOf(line.units, wholeUnits)}
        />
      </TableCell>
      <TableCell align="right">{money(line.revenue)}</TableCell>
    </TableRow>
  ));
}

// A group's own line: a category above its products, or the supplier under
// every category. Bold, with what it sold and how many of its products moved
// beside the name; its bar is its share against `maxUnits`.
function GroupRow({
  label,
  summary,
  units,
  revenue,
  maxUnits,
  share,
  variant,
}: {
  label: string;
  summary: string;
  units: number;
  revenue: number;
  maxUnits: number;
  share: number | null;
  // A band sits above what it introduces; a total sits under what adds up
  // to it, drawn as a rule rather than a tint so it reads as the line the
  // list adds up under, not as one more line of it.
  variant: "band" | "total";
}) {
  return (
    <TableRow
      sx={{
        "& .MuiTableCell-root":
          variant === "band"
            ? {
                bgcolor: "action.selected",
                fontWeight: 700,
                borderTop: 1,
                borderTopColor: "divider",
              }
            : {
                borderTop: 2,
                borderTopColor: "divider",
                borderBottom: 0,
                fontWeight: 700,
              },
      }}
    >
      <TableCell />
      <TableCell
        title={`${label}: ${summary}`}
        sx={{
          width: "100%",
          maxWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
        <Typography
          component="span"
          variant="caption"
          color="text.secondary"
          sx={{ ml: 1, fontWeight: 400 }}
        >
          {summary}
        </Typography>
      </TableCell>
      <TableCell align="right">{formatUnits(units)}</TableCell>
      <TableCell sx={{ minWidth: SHARE_COLUMN_WIDTH }}>
        <ShareBar value={units} max={maxUnits} share={share} />
      </TableCell>
      <TableCell align="right">{money(revenue)}</TableCell>
    </TableRow>
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
  // Grouped under the categories, or one flat list across the supplier. The
  // same reply either way: the flat fifteen is a merge of the per-category
  // rows, so switching costs nothing.
  const [view, setView] = useState<SupplierItemView>("category");
  // Null until a pill is picked: the dialog opens on the first category,
  // which is the one that sold most on the best sellers and least on the
  // slow sellers, so there is a list on screen from the first paint.
  const [picked, setPicked] = useState<string | null>(null);

  const totals = data ? supplierTotals(data) : null;
  // One category needs no pills and no supplier line: the category is the
  // whole of it.
  const grouped = (data?.categories.length ?? 0) > 1;
  const category = picked ?? data?.categories[0]?.category ?? ALL_CATEGORIES;
  const showingAll = !grouped || category === ALL_CATEGORIES;
  const shown =
    data?.categories.filter((c) => showingAll || c.category === category) ?? [];
  const flat = data && view === "item" ? flatLines(data) : [];

  // Under the table. By item: how much of the supplier the list covers and
  // how many products sold nothing. By category, across every category: how
  // many products sold nothing; on one category: how much of it the list
  // covers, the band row already saying how many of its products moved.
  const note = data
    ? view === "item"
      ? flatNote(data, flat)
      : showingAll
        ? supplierNote(data)
        : (shown[0] && categoryNote(shown[0])) || null
    : null;

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
          <DownloadPdf target={target} view={view} range={range} data={data} />
          <IconButton aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            mb: 1.5,
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {supplierItemsCaption(target.order, view, range)}
          </Typography>
          {/* Offered only once there are categories to group by: with one,
              the two layouts are the same table. */}
          {grouped && (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={view}
              onChange={(_e, next: SupplierItemView | null) => {
                if (next) setView(next);
              }}
              aria-label="Layout"
            >
              {SUPPLIER_ITEM_VIEWS.map((v) => (
                <ToggleButton key={v} value={v} sx={{ px: 1.5, py: 0.5 }}>
                  {SUPPLIER_ITEM_VIEW_LABELS[v]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}
        </Box>

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
            {data && data.categories.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 3 }} align="center">
                This supplier has no products filed under it.
              </Typography>
            ) : (
              <Box>
                {data && grouped && totals && view === "category" && (
                  <CategoryPills
                    categories={data.categories}
                    totals={totals}
                    value={category}
                    onChange={setPicked}
                  />
                )}
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
                      {totals && view === "item" && (
                        <>
                          <LineRows
                            lines={flat}
                            maxUnits={data ? supplierMaxUnits(data) : 0}
                            wholeUnits={totals.units}
                          />
                          <GroupRow
                            variant="total"
                            label={`All ${totals.items} products that sold`}
                            summary={
                              totals.unsoldItems > 0
                                ? `${totals.unsoldItems} did not sell`
                                : ""
                            }
                            units={totals.units}
                            revenue={totals.revenue}
                            maxUnits={data ? supplierMaxUnits(data) : 0}
                            share={totals.units > 0 ? 100 : null}
                          />
                        </>
                      )}

                      {totals &&
                        view === "category" &&
                        shown.map((cat) => (
                          <Fragment key={cat.category}>
                            {/* The category's own line, which its products
                                are measured against: their bars fill to its
                                best seller and their shares are of its
                                units. This bar is the category's share of
                                the supplier, against the biggest category. */}
                            <GroupRow
                              variant="band"
                              label={cat.category}
                              summary={soldSummary(
                                cat.total.items,
                                cat.unsoldItems,
                              )}
                              units={cat.total.units}
                              revenue={cat.total.revenue}
                              maxUnits={totals.maxUnits}
                              share={shareOf(cat.total.units, totals.units)}
                            />

                            {cat.lines.length === 0 && (
                              <TableRow>
                                <TableCell />
                                <TableCell
                                  colSpan={4}
                                  sx={{ color: "text.secondary" }}
                                >
                                  Nothing sold in this category over the period.
                                </TableCell>
                              </TableRow>
                            )}

                            <LineRows
                              lines={cat.lines}
                              maxUnits={cat.total.maxUnits}
                              wholeUnits={cat.total.units}
                            />
                          </Fragment>
                        ))}

                      {totals &&
                        view === "category" &&
                        showingAll &&
                        grouped && (
                          <GroupRow
                            variant="total"
                            label="All categories"
                            summary={soldSummary(
                              totals.items,
                              totals.unsoldItems,
                            )}
                            units={totals.units}
                            revenue={totals.revenue}
                            maxUnits={totals.maxUnits}
                            share={totals.units > 0 ? 100 : null}
                          />
                        )}
                    </TableBody>
                  </Table>
                </Box>
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

"use client";

import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import PrintIcon from "@mui/icons-material/Print";
import JsBarcode from "jsbarcode";
import {
  LABEL_WIDTH_MM,
  LABEL_HEIGHT_MM,
  LABEL_PADDING_MM,
  LABEL_GAP_MM,
  LABEL_NAME_PT,
  LABEL_BARCODE_MAX_HEIGHT_MM,
} from "@/constants/inventory";
import { printHtmlDocument } from "@/utils/print-document";

interface Props {
  open: boolean;
  barcode: string;
  name: string;
  onClose: () => void;
}

// Renders the barcode once to a PNG data URL and reuses it for both the preview
// and the print window. A PNG <img> always renders, including cross-document,
// which an SVG's outerHTML does not.
export default function BarcodeLabelDialog({
  open,
  barcode,
  name,
  onClose,
}: Props) {
  const [quantity, setQuantity] = useState(1);

  // Pure derivation of the barcode image from its value. Empty string when the
  // value isn't a renderable EAN-13 (e.g. a supplier code left in the field).
  const dataUrl = useMemo(() => {
    if (typeof window === "undefined" || !barcode) return "";
    const canvas = document.createElement("canvas");
    try {
      JsBarcode(canvas, barcode, {
        // Rendered at 1.5x the on-screen size it needs. The label is only 48mm
        // wide, so a coarser raster resamples to ragged bars on a 203dpi
        // thermal head and scans unreliably. Proportions are unchanged.
        format: "EAN13",
        width: 3,
        height: 90,
        fontSize: 24,
        // Symmetric quiet zone so the code sits centred rather than left-heavy.
        margin: 15,
      });
      return canvas.toDataURL("image/png");
    } catch {
      return "";
    }
  }, [barcode]);

  const count = Math.max(1, Math.min(200, quantity || 1));

  function handlePrint() {
    if (!dataUrl) return;
    const labels = Array.from({ length: count })
      .map(
        () => `<div class="label">
          <div class="name">${escapeHtml(name)}</div>
          <img src="${dataUrl}" alt="${escapeHtml(barcode)}" />
        </div>`,
      )
      .join("");
    printHtmlDocument(`<!DOCTYPE html><html><head><title>barcode-${escapeHtml(barcode)}</title>
      <style>
        @page { size: ${LABEL_WIDTH_MM}mm ${LABEL_HEIGHT_MM}mm; margin: 0; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
        /* Width 100% (not a fixed mm) so the label fills and centres on whatever
           page it lands on: a die-cut label sized by @page, or a wider roll. */
        .label {
          width: 100%;
          min-height: ${LABEL_HEIGHT_MM}mm;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: ${LABEL_GAP_MM}mm;
          padding: ${LABEL_PADDING_MM}mm;
          page-break-after: always;
          overflow: hidden;
        }
        /* Without this the final break feeds one blank label off the roll. */
        .label:last-child { page-break-after: auto; }
        .name {
          font-size: ${LABEL_NAME_PT}pt;
          font-weight: 600;
          text-align: center;
          width: 100%;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* Both dimensions auto so the two maxes scale the code down on aspect:
           on this stock the height budget binds, not the width. */
        img {
          display: block;
          margin: 0 auto;
          width: auto;
          height: auto;
          max-width: 92%;
          max-height: ${LABEL_BARCODE_MAX_HEIGHT_MM}mm;
        }
      </style></head><body>${labels}</body></html>`);
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Print barcode label</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1, alignItems: "center" }}>
          <Box
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              p: 1.5,
              textAlign: "center",
              minWidth: 200,
            }}
          >
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600,
                mb: 0.5,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {name || "Unnamed item"}
            </Typography>
            {dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={dataUrl}
                alt={barcode}
                style={{ display: "block", margin: "0 auto", maxWidth: "100%" }}
              />
            ) : (
              <Typography variant="caption" color="text.secondary">
                Not a valid barcode.
              </Typography>
            )}
          </Box>

          <TextField
            label="How many labels?"
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            slotProps={{ htmlInput: { min: 1, max: 200, step: 1 } }}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button
          variant="contained"
          startIcon={<PrintIcon />}
          onClick={handlePrint}
          disabled={!dataUrl}
        >
          Print {count}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

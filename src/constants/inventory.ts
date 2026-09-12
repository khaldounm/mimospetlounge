// The clinic's own vocabulary, taken from the Category table in the old Access
// system rather than invented here: these are the words on the shelves. Tab
// order follows this list, so it runs roughly biggest-shelf-first.
export const INVENTORY_CATEGORIES = [
  "Accessories",
  "Food",
  "Treats",
  "Toys",
  "Medication",
  "Vaccines",
  "Supplements",
  "Grooming Supplies",
  "Consumables",
  "Parasite Control",
  "Litter",
  "Other",
] as const;

export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

// Physical size of the printed barcode labels, in millimetres. Change these to
// match your label stock; the print layout and @page rule read from here. The
// counter roll is 48 x 25 die-cut, so the driver's stock must say the same.
export const LABEL_WIDTH_MM = 48;
export const LABEL_HEIGHT_MM = 25;

// Label internals, also in millimetres. Kept here rather than inline in the
// print CSS because the barcode's height budget is derived from them.
export const LABEL_PADDING_MM = 1.5;
export const LABEL_GAP_MM = 1;
export const LABEL_NAME_PT = 8;

// One line of LABEL_NAME_PT text, allowing for leading. 1pt = 0.3528mm.
const LABEL_NAME_LINE_MM = LABEL_NAME_PT * 0.3528 * 1.15;

// Whatever vertical space is left for the barcode once the padding, the name
// line and the gap are taken out. At 25mm stock the code would otherwise
// overflow and be clipped by the die cut, losing the human-readable digits.
export const LABEL_BARCODE_MAX_HEIGHT_MM =
  LABEL_HEIGHT_MM - 2 * LABEL_PADDING_MM - LABEL_NAME_LINE_MM - LABEL_GAP_MM;

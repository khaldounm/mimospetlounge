"use client";

import Link from "@/components/ui/AppLink";
import Badge from "@mui/material/Badge";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";

import type { InventoryCategoryCount } from "@/lib/inventory";

/**
 * Category strip for the inventory list.
 *
 * These were accordions holding every item in the page at once. Tabs render one
 * category at a time, and each tab is a real link to /inventory/<category>, so
 * a category can be bookmarked, opened in a new tab, and reloaded without
 * client state deciding what is on screen.
 */
export default function InventoryCategoryTabs({
  categories,
  active,
}: {
  categories: InventoryCategoryCount[];
  /** Selected category name, or null on the all-categories view. */
  active: string | null;
}) {
  const total = categories.reduce((sum, c) => sum + c.count, 0);
  const value = active ?? "";

  return (
    <Tabs
      value={value}
      // The clinic has enough categories to overflow a phone; scroll buttons
      // keep every tab reachable rather than wrapping them onto a second row
      // that shifts the table down.
      variant="scrollable"
      scrollButtons="auto"
      allowScrollButtonsMobile
      sx={{
        mb: 2,
        borderBottom: 1,
        borderColor: "divider",
        minHeight: 44,
        "& .MuiTab-root": {
          minHeight: 44,
          textTransform: "none",
          fontWeight: 500,
        },
      }}
    >
      <Tab
        component={Link}
        href="/inventory"
        value=""
        label={
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <span>All</span>
            <Typography variant="caption" color="text.secondary">
              {total.toLocaleString()}
            </Typography>
          </Stack>
        }
      />
      {categories.map((c) => (
        <Tab
          key={c.category}
          component={Link}
          href={`/inventory/${c.slug}`}
          value={c.category}
          label={
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              {/* The badge only appears when something is actually low, so a
                  healthy shelf carries no decoration. */}
              <Badge
                color="warning"
                invisible={c.lowStockCount === 0}
                variant="dot"
                anchorOrigin={{
                  vertical: "top",
                  horizontal: "left",
                }}
                sx={{ "& .MuiBadge-badge": { left: -10, top: 7.5 } }}
              >
                <span>{c.category}</span>
                <span>&nbsp;</span>
                <Typography variant="caption" color="text.secondary">
                  {c.count.toLocaleString()}
                </Typography>
              </Badge>
            </Stack>
          }
        />
      ))}
    </Tabs>
  );
}

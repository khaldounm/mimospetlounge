"use client";

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

interface Props {
  title: string;
  subtitle?: string;
  loading?: boolean;
  // Rendered above the content and never dimmed (e.g. the date-range control),
  // so it stays usable while a new range is loading.
  controls?: React.ReactNode;
  // Called when the section is opened. This is where a section's figures are
  // fetched from, so nothing is computed for one nobody looks at.
  onExpand?: () => void;
  // Opens on load. For a section whose content is the reason the page was
  // opened, rather than one somebody goes looking for.
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

// One collapsible section, collapsed on load, whose content is fetched the
// first time it is opened. Range-scoped sections pass `loading` while a new
// range is fetching, which shows a top progress bar and dims the stale content.
// Shared by the analytics dashboard and the partner ledgers.
export default function CollapsibleSection({
  title,
  subtitle,
  loading,
  controls,
  onExpand,
  defaultExpanded,
  children,
}: Props) {
  return (
    <Accordion
      disableGutters
      elevation={0}
      defaultExpanded={defaultExpanded}
      onChange={(_e, expanded) => {
        if (expanded) onExpand?.();
      }}
      // A collapsed section keeps nothing in the DOM. MUI mounts accordion
      // children whether or not anyone opens them, so the page was building
      // fourteen chart surfaces behind seven closed headers.
      slotProps={{ transition: { unmountOnExit: true } }}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        mb: 1.5,
        "&:before": { display: "none" },
        // MUI rounds only the outer corners of the first and last accordion in a
        // group; force a uniform radius so every card is the same shape.
        "&:first-of-type": { borderRadius: 2 },
        "&:last-of-type": { borderRadius: 2 },
        "&.Mui-expanded": { mb: 1.5 },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 2 }}>
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ alignItems: "baseline", flexWrap: "wrap" }}
        >
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 2, pt: 0 }}>
        {controls && <Box sx={{ mb: 2.5 }}>{controls}</Box>}
        <Box sx={{ position: "relative" }}>
          {loading && (
            <LinearProgress
              sx={{
                position: "absolute",
                top: -6,
                left: 0,
                right: 0,
                borderRadius: 1,
              }}
            />
          )}
          <Box
            sx={{
              opacity: loading ? 0.55 : 1,
              transition: "opacity 150ms ease",
              pointerEvents: loading ? "none" : "auto",
            }}
          >
            {children}
          </Box>
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

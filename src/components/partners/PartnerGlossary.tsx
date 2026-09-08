"use client";

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import HelpIcon from "@mui/icons-material/HelpOutlined";
import { PARTNER_GLOSSARY } from "@/constants/partner";

// Collapsed by default: it answers a question that only comes up once, and the
// figures should get the space the rest of the time.
export default function PartnerGlossary() {
  return (
    <Accordion
      disableGutters
      elevation={0}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        mb: 1.5,
        "&:before": { display: "none" },
        "&:first-of-type": { borderRadius: 2 },
        "&:last-of-type": { borderRadius: 2 },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <HelpIcon fontSize="small" color="action" />
          <Typography variant="body2">
            What do revenue, capital and profit mean here?
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 2, pb: 2 }}>
        <Stack spacing={1.5}>
          {PARTNER_GLOSSARY.map((entry) => (
            <Stack key={entry.term} direction="row" spacing={1.5}>
              <Typography
                variant="body2"
                sx={{ fontWeight: 600, minWidth: 110, flexShrink: 0 }}
              >
                {entry.term}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {entry.meaning}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

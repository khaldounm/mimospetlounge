"use client";

import { useEffect, useRef, useState } from "react";
import Link from "@/components/ui/AppLink";
import {
  Box,
  Button,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { apiRequest } from "@/utils/api-client";
import AlphabetBar from "@/components/ui/AlphabetBar";
import TablePaginationBar from "@/components/ui/TablePaginationBar";
import type { PatientDTO } from "@/types/entities";
import PatientFormDialog from "./PatientFormDialog";
import ReviewBadge from "@/components/ui/ReviewBadge";
import ReviewFilterChip from "@/components/ui/ReviewFilterChip";

interface Props {
  initialPatients: PatientDTO[];
  initialTotal: number;
  pageSize: number;
  letters: { letter: string; count: number }[];
  initialReviewCount: number;
  canWrite: boolean;
}

export default function PatientsTable({
  initialPatients,
  initialTotal,
  pageSize,
  letters,
  initialReviewCount,
  canWrite,
}: Props) {
  const [patients, setPatients] = useState(initialPatients);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(0); // zero-based, matching the pager
  const [query, setQuery] = useState("");
  const [letter, setLetter] = useState<string | null>(null);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [reviewCount, setReviewCount] = useState(initialReviewCount);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const firstRender = useRef(true);

  async function load(q: string, l: string | null, p: number, review: boolean) {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (l) params.set("letter", l);
    if (review) params.set("review", "1");
    params.set("page", String(p + 1));
    setLoading(true);
    try {
      const data = await apiRequest<{
        patients: PatientDTO[];
        total: number;
        reviewCount: number;
      }>(`/api/patients?${params}`);
      setPatients(data.patients);
      setTotal(data.total);
      setReviewCount(data.reviewCount);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => void load(query, letter, page, reviewOnly), 300);
    return () => clearTimeout(t);
  }, [query, letter, page, reviewOnly]);

  // A new filter invalidates the current offset.
  function changeFilter(next: () => void) {
    setPage(0);
    next();
  }

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}
      >
        <Typography variant="h4">Patients</Typography>
        <Stack direction="row" spacing={1}>
          <Button component={Link} href="/clients" variant="outlined">
            Clients
          </Button>
          {canWrite && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setDialogOpen(true)}
            >
              New patient
            </Button>
          )}
        </Stack>
      </Stack>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ mb: 2, alignItems: { sm: "center" } }}
      >
        <TextField
          placeholder="Search by pet or owner name, phone, species, breed"
          value={query}
          onChange={(e) => changeFilter(() => setQuery(e.target.value))}
          fullWidth
          size="small"
        />
        <ReviewFilterChip
          count={reviewCount}
          active={reviewOnly}
          onToggle={(next) => changeFilter(() => setReviewOnly(next))}
          noun="pets"
        />
      </Stack>

      <AlphabetBar
        letters={letters}
        noun="pets"
        value={letter}
        onChange={(next) => changeFilter(() => setLetter(next))}
        disabled={loading}
      />

      <TableContainer component={Paper}>
        <Table sx={{ tableLayout: "fixed" }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: "30%" }}>Name</TableCell>
              <TableCell sx={{ width: "20%" }}>Species</TableCell>
              <TableCell sx={{ width: "25%" }}>Breed</TableCell>
              <TableCell sx={{ width: "25%" }}>Owner</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {patients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    {reviewOnly
                      ? "Nothing left to review."
                      : "No patients found."}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              patients.map((p) => (
                <TableRow key={p.patientId} hover>
                  <TableCell>
                    <Link href={`/patients/${p.patientId}`}>{p.name}</Link>
                    <ReviewBadge
                      needsReview={p.needsReview}
                      note={p.reviewNote}
                    />
                  </TableCell>
                  <TableCell>{p.species ?? "-"}</TableCell>
                  <TableCell>{p.breed ?? "-"}</TableCell>
                  <TableCell>{p.clientName ?? "-"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <TablePaginationBar
          page={page}
          count={total}
          pageSize={pageSize}
          onChange={setPage}
          loading={loading}
          noun="pets"
        />
      </TableContainer>

      <PatientFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void load(query, letter, page, reviewOnly)}
      />
    </Box>
  );
}

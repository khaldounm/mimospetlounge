"use client";

import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CancelRoundedIcon from "@mui/icons-material/CancelRounded";
import { apiRequest, redirectToSignIn } from "@/utils/api-client";
import { formatDateTime } from "@/utils/format";
import type { RoleOption, UserDTO } from "@/types/entities";
import UserFormDialog from "./UserFormDialog";
import ResetPasswordDialog from "./ResetPasswordDialog";

interface Props {
  initialUsers: UserDTO[];
  roleOptions: RoleOption[];
  currentUserId: number | null;
  canWrite: boolean;
}

// Which door this person last came through: a passkey, or a password. Two
// states only, read like a checklist. Someone who holds a passkey but last
// typed a password is still "Password": the question is what they use, not
// what they own. Never signed in counts as Password until they do.
function usesPasskey(user: UserDTO): boolean {
  const passkeyAt = user.lastPasskeyUsedAt;
  const passwordAt = user.lastPasswordLoginAt;
  if (!passkeyAt) return false;
  return !passwordAt || passkeyAt >= passwordAt;
}

// Soft pill: tinted ground, dark text, filled icon. Softer than the solid
// Active chip beside it so the two columns do not shout at each other.
function SignInChip({ user }: { user: UserDTO }) {
  const ok = usesPasskey(user);
  return (
    <Chip
      size="small"
      icon={ok ? <CheckCircleRoundedIcon /> : <CancelRoundedIcon />}
      label={ok ? "Passkey" : "Password"}
      sx={(theme) => {
        const tone = ok ? theme.palette.success : theme.palette.error;
        return {
          bgcolor: alpha(tone.main, 0.12),
          color: tone.dark,
          fontWeight: 600,
          "& .MuiChip-icon": { color: tone.main },
        };
      }}
    />
  );
}

// One line above the table, over active staff only: inactive accounts are not
// being asked to do anything.
function passkeySummary(users: UserDTO[]): string {
  const active = users.filter((u) => u.isActive);
  if (active.length === 0) return "";
  const using = active.filter(usesPasskey).length;
  return using === active.length
    ? `All ${active.length} staff sign in with a passkey.`
    : `${using} of ${active.length} staff sign in with a passkey.`;
}

export default function UsersTable({
  initialUsers,
  roleOptions,
  currentUserId,
  canWrite,
}: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserDTO | null>(null);
  const [pwUser, setPwUser] = useState<UserDTO | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstRender = useRef(true);

  async function load(q: string) {
    const params = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
    const data = await apiRequest<{ users: UserDTO[] }>(`/api/users${params}`);
    setUsers(data.users);
  }

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => void load(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(user: UserDTO) {
    setEditing(user);
    setFormOpen(true);
  }

  // Ends every session this person has open, without disabling the account:
  // they can sign back in immediately. Allowed on yourself, which signs you out
  // of this screen too, so the list is not reloaded afterwards.
  async function signOutEverywhere(user: UserDTO) {
    setError(null);
    setBusyId(user.userId);
    try {
      await apiRequest(`/api/users/${user.userId}/signout`, { method: "POST" });
      if (user.userId === currentUserId) {
        // Not /login: the cookie is still in the browser and proxy.ts reads it
        // as a live session, so that would bounce back into the dashboard before
        // the layout eventually turned it around. Go where it gets cleared.
        redirectToSignIn();
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign user out");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(user: UserDTO) {
    setError(null);
    setBusyId(user.userId);
    try {
      await apiRequest(`/api/users/${user.userId}`, {
        method: "PATCH",
        body: { isActive: !user.isActive },
      });
      await load(query);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}
      >
        <Typography variant="h4">Staff</Typography>
        {canWrite && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>
            New user
          </Button>
        )}
      </Stack>

      <TextField
        placeholder="Search by name or email"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        fullWidth
        size="small"
        sx={{ mb: 2 }}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {passkeySummary(users) && (
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {passkeySummary(users)}
        </Typography>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Sign-in</TableCell>
              <TableCell>Last login</TableCell>
              {canWrite && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canWrite ? 7 : 6} align="center">
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    No users found.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => {
                const isSelf = u.userId === currentUserId;
                return (
                  <TableRow key={u.userId} hover>
                    <TableCell>
                      {u.firstName} {u.lastName}
                      {isSelf && (
                        <Chip size="small" label="You" sx={{ ml: 1 }} />
                      )}
                    </TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>{u.roleName}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={u.isActive ? "success" : "default"}
                        variant={u.isActive ? "filled" : "outlined"}
                        label={u.isActive ? "Active" : "Inactive"}
                      />
                    </TableCell>
                    <TableCell>
                      <SignInChip user={u} />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}
                    </TableCell>
                    {canWrite && (
                      <TableCell align="right">
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ justifyContent: "flex-end" }}
                        >
                          <Button size="small" onClick={() => openEdit(u)}>
                            Edit
                          </Button>
                          <Button size="small" onClick={() => setPwUser(u)}>
                            Reset password
                          </Button>
                          <Tooltip
                            title={
                              isSelf
                                ? "Ends your own session here too"
                                : "Ends every session on every device. They can sign back in."
                            }
                          >
                            <span>
                              <Button
                                size="small"
                                disabled={busyId === u.userId}
                                onClick={() => void signOutEverywhere(u)}
                              >
                                Sign out
                              </Button>
                            </span>
                          </Tooltip>
                          <Tooltip
                            title={
                              isSelf
                                ? "You cannot deactivate your own account"
                                : ""
                            }
                          >
                            <span>
                              <Button
                                size="small"
                                color={u.isActive ? "error" : "primary"}
                                disabled={
                                  (isSelf && u.isActive) || busyId === u.userId
                                }
                                onClick={() => void toggleActive(u)}
                              >
                                {u.isActive ? "Deactivate" : "Activate"}
                              </Button>
                            </span>
                          </Tooltip>
                        </Stack>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <UserFormDialog
        open={formOpen}
        user={editing}
        roleOptions={roleOptions}
        isSelf={editing?.userId === currentUserId}
        onClose={() => setFormOpen(false)}
        onSaved={() => void load(query)}
      />
      <ResetPasswordDialog
        open={pwUser !== null}
        user={pwUser}
        onClose={() => setPwUser(null)}
        onSaved={() => setPwUser(null)}
      />
    </Box>
  );
}

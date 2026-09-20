import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { liveSession } from "@/lib/session-user";
import { prisma } from "@/lib/prisma";
import { listPasskeys } from "@/lib/passkeys";
import ChangePasswordForm from "@/components/users/ChangePasswordForm";
import PasskeyList from "@/components/ui/PasskeyList";
import { PASSKEY_ONLY } from "@/constants/passkeys";

// Your own account. Not gated by any permission: it belongs to whoever is
// signed in, whatever their role. Passkeys and, for anyone still on one, the
// password.
export default async function AccountPage() {
  const session = await liveSession();
  const userId = session?.user?.userId;

  // Read the row rather than the token: a name or role changed by an admin
  // since sign-in should show as it is now, not as the cookie remembers it.
  const [user, passkeys] = userId
    ? await Promise.all([
        prisma.user.findUnique({
          where: { userId },
          select: {
            firstName: true,
            lastName: true,
            email: true,
            passwordHash: true,
            role: { select: { name: true } },
          },
        }),
        listPasskeys(userId),
      ])
    : [null, []];

  // A stored hash only counts as a way in while passwords are on. At a
  // passkey-only clinic it is inert, so the passkey list must treat the
  // person as having no other door and refuse to remove their last passkey.
  const hasPassword = !PASSKEY_ONLY && Boolean(user?.passwordHash);

  return (
    <Stack spacing={4}>
      <Stack spacing={0.5}>
        <Typography variant="h4">Your account</Typography>
        {user && (
          <Typography color="text.secondary">
            {user.firstName} {user.lastName}, {user.email}, signed in as{" "}
            {user.role.name}
          </Typography>
        )}
      </Stack>
      <PasskeyList initial={passkeys} hasPassword={hasPassword} />
      {hasPassword && <ChangePasswordForm />}
    </Stack>
  );
}

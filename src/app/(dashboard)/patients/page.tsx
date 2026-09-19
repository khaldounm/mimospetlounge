import { liveSession } from "@/lib/session-user";
import { hasPermission } from "@/lib/permissions";
import { listPatients } from "@/lib/patients";
import PatientsTable from "@/components/patients/PatientsTable";

export default async function PatientsPage() {
  const session = await liveSession();
  const canWrite = hasPermission(session?.user, "patients:write");
  // Birthday wishes go out as notifications, so the list's Send takes the
  // permission every other send does rather than the patient edit right.
  const canSendWishes = hasPermission(session?.user, "notifications:write");

  // First page only. Paging, search and the letter filter all run in SQL, and
  // the owner list the create dialog needs is fetched when that dialog opens.
  const { patients, total, pageSize, letters, reviewCount } =
    await listPatients({ page: 1 });

  return (
    <PatientsTable
      initialPatients={patients}
      initialTotal={total}
      pageSize={pageSize}
      letters={letters}
      initialReviewCount={reviewCount}
      canWrite={canWrite}
      canSendWishes={canSendWishes}
    />
  );
}

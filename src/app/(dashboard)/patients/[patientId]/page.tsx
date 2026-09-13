import { notFound } from "next/navigation";
import { liveSession } from "@/lib/session-user";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { toClinicalRecordDTO } from "@/lib/patients";
import { toDateOnly } from "@/utils/format";
import type {
  ClinicalRecordDTO,
  PatientDTO,
  PatientPickerOption,
  ServicePickerOption,
} from "@/types/entities";
import PatientDetail from "@/components/patients/PatientDetail";

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ patientId: string }>;
}) {
  const { patientId } = await params;
  const id = Number(patientId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const session = await liveSession();
  const canWritePatient = hasPermission(session?.user, "patients:write");
  const canReadClinical = hasPermission(session?.user, "clinical:read");
  const canWriteClinical = hasPermission(session?.user, "clinical:write");
  // Sending is a notification action, so it rides on the messaging permission
  // rather than on clinical:write: reception sends, they do not author records.
  const canSendRecord = hasPermission(session?.user, "notifications:write");

  const [patient, rawServices] = await Promise.all([
    prisma.patient.findFirst({
      where: { patientId: id, deletedAt: null },
      include: {
        client: {
          select: {
            clientId: true,
            firstName: true,
            lastName: true,
            phone: true,
            phone2: true,
            // The owner's other pets, for the add-record dialog to move
            // between without leaving the form. Same query, no extra trip.
            patients: {
              where: { deletedAt: null },
              orderBy: { name: "asc" },
              select: {
                patientId: true,
                name: true,
                species: true,
                breed: true,
              },
            },
          },
        },
        clinicalRecords: {
          where: { deletedAt: null },
          orderBy: { performedAt: "desc" },
          include: {
            performer: { select: { firstName: true, lastName: true } },
          },
        },
      },
    }),
    prisma.service.findMany({
      where: { isActive: true },
      select: { serviceId: true, name: true, category: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!patient) notFound();

  const services: ServicePickerOption[] = rawServices;
  const pets: PatientPickerOption[] = patient.client.patients;

  const dto: PatientDTO = {
    patientId: patient.patientId,
    clientId: patient.clientId,
    name: patient.name,
    species: patient.species,
    breed: patient.breed,
    dateOfBirth: toDateOnly(patient.dateOfBirth),
    sex: patient.sex,
    isNeutered: patient.isNeutered,
    microchipId: patient.microchipId,
    notes: patient.notes,
    needsReview: patient.needsReview,
    reviewNote: patient.reviewNote,
  };

  const records: ClinicalRecordDTO[] = canReadClinical
    ? patient.clinicalRecords.map(toClinicalRecordDTO)
    : [];

  return (
    <PatientDetail
      patient={dto}
      clientName={`${patient.client.firstName} ${patient.client.lastName}`}
      initialRecords={records}
      services={services}
      pets={pets}
      canWritePatient={canWritePatient}
      canReadClinical={canReadClinical}
      canWriteClinical={canWriteClinical}
      canSendRecord={canSendRecord}
      clientPhone={patient.client.phone ?? patient.client.phone2 ?? null}
    />
  );
}

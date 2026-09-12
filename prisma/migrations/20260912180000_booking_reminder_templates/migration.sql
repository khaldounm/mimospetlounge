-- Reminder templates attached to bookings.
--
-- A booking type names the reminder template a new booking of that type
-- starts with; the booking then carries its own pointer, changeable on the
-- form and on the Upcoming tab. Both columns are nullable: bookings taken
-- before this migration have no template and the send path falls back to the
-- type's default, so nothing about existing data or behaviour changes here.
-- Templates are deactivated rather than deleted, but SET NULL keeps a hard
-- delete from taking bookings down with it.

-- AlterTable
ALTER TABLE "booking_types" ADD COLUMN     "default_template_id" INTEGER;

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "reminder_template_id" INTEGER;

-- AddForeignKey
ALTER TABLE "booking_types" ADD CONSTRAINT "booking_types_default_template_id_fkey" FOREIGN KEY ("default_template_id") REFERENCES "notification_templates"("template_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_reminder_template_id_fkey" FOREIGN KEY ("reminder_template_id") REFERENCES "notification_templates"("template_id") ON DELETE SET NULL ON UPDATE CASCADE;

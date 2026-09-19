-- Marks a pet as dealt with on the upcoming-birthdays list.
--
-- The list shows every pet with a birthday in the next few days so the counter
-- can send wishes. This is the day someone ticked the pet off. It is judged
-- against the current window rather than cleared: a tick from last year's
-- window does not count this year. Nullable, no backfill.

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "birthday_greeted_on" DATE;

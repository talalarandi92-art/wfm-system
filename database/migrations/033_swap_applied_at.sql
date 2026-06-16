-- 033_swap_applied_at.sql
-- Track when an approved shift/OFF swap was actually written to the schedule.
ALTER TABLE request_shift_swaps
  ADD COLUMN IF NOT EXISTS applied_at timestamptz;

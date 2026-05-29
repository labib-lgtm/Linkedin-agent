-- 026 — lower the warm-up comment target from 3 to 2.
--
-- Two genuine, on-topic comments already create real recognition before a
-- connection request; the marginal third buys very little. With 443 enrolled
-- prospects at 3/each (1,317 comments needed) we were looking at ~768 days
-- to drain the queue. At 2/each (886 needed) plus the daily-cap raise to 5,
-- the runway drops to ~177 days.
--
-- Schema-level DEFAULT change covers all FUTURE enrollments (the bulk +
-- single enroll routes don't set comments_target explicitly — they rely on
-- the DEFAULT). The UPDATE backfills currently-engaging prospects so the
-- whole cohort benefits, including London Lazerson who graduates at 2/2.

alter table public.prospect_outreach
  alter column comments_target set default 2;

update public.prospect_outreach
   set comments_target = 2
 where stage = 'engaging'
   and comments_target = 3;

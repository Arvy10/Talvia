-- "running" lets a run be reserved atomically (inserted before the slow
-- website fetch + AI call even start) instead of only being recorded
-- after the fact, which is what let concurrent requests race past the
-- cooldown/quota check together.
alter table business_context_analysis_runs
  drop constraint if exists business_context_analysis_runs_status_check;
alter table business_context_analysis_runs
  add constraint business_context_analysis_runs_status_check
  check (status in ('running', 'succeeded', 'failed', 'insufficient_content'));

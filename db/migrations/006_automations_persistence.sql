-- Persisted, workspace-scoped Automations V1.
begin;

alter table automations add column if not exists description text;
alter table automations drop constraint if exists automations_status_check;
alter table automations add constraint automations_status_check check (status in ('active','inactive','archived'));
update automations set status = case when status in ('draft','paused') then 'inactive' else status end;

alter table activities add column if not exists source varchar(24) not null default 'user';
alter table activities add column if not exists automation_run_id uuid;
alter table activities add constraint activities_source_check check (source in ('user','automation','test'));

alter table automation_runs add column if not exists trigger_type varchar(64);
alter table automation_runs add constraint automation_runs_activity_fk foreign key (activity_id) references activities(id) on delete set null;
alter table activities add constraint activities_automation_run_fk foreign key (automation_run_id) references automation_runs(id) on delete set null;

alter table conversations add column if not exists to_process_at timestamptz;
create index if not exists automations_workspace_trigger_idx on automations(workspace_id, trigger_type) where status = 'active';
create index if not exists automation_runs_workspace_created_idx on automation_runs(workspace_id, created_at desc);
create index if not exists activities_workspace_event_created_idx on activities(workspace_id, event_type, created_at desc);
create unique index if not exists automation_runs_activity_once_unique on automation_runs(automation_id, activity_id) where activity_id is not null;

commit;

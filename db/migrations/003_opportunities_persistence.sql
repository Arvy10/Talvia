-- Persist fields already exposed by the existing Talvia Opportunities UI.
begin;

alter table opportunities add column source_channel varchar(24);
alter table opportunities add column final_value_minor bigint check (final_value_minor is null or final_value_minor >= 0);
alter table opportunities add column next_action_completed_at timestamptz;

create index opportunities_workspace_stage_idx on opportunities(workspace_id, stage, updated_at desc);
create index opportunities_contact_idx on opportunities(contact_id, created_at desc);

commit;

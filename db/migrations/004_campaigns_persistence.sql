-- Make the pre-existing Campaign tables ready for the persisted Talvia module.
begin;

create index if not exists campaigns_workspace_created_idx
  on campaigns(workspace_id, created_at desc);
create index if not exists campaign_participants_contact_idx
  on campaign_participants(contact_id, created_at desc);
create index if not exists campaign_steps_campaign_position_idx
  on campaign_steps(campaign_id, position);

-- opportunities.campaign_id already references campaigns(id) in 001_initial_schema.sql.
-- It intentionally remains nullable because an opportunity can be created outside a campaign.

commit;

import { database } from "../database";
import { sendAcquisitionEmail } from "./resend";
import { acquisitionTemplate } from "./templates";
import { createUnsubscribeToken } from "./unsubscribe";

type Delivery = { id: string; lead_id: string; email_type: "welcome" | "day_1" | "day_3" | "beta_access"; email: string; first_name: string | null };

export async function runAcquisitionScheduler(limit = 25) {
  const client = await database.connect(); let sent = 0; let failed = 0;
  try {
    await client.query("begin");
    const claimed = await client.query<Delivery>(`with due as (select d.id from acquisition_email_deliveries d join beta_leads l on l.id=d.lead_id where d.status in ('pending','failed') and d.scheduled_at<=now() and l.status<>'UNSUBSCRIBED' and (d.email_type<>'beta_access' or l.status='INVITED') order by d.scheduled_at for update of d skip locked limit $1) update acquisition_email_deliveries d set status='sending',attempt_count=d.attempt_count+1,updated_at=now() from due where d.id=due.id returning d.id,d.lead_id,d.email_type,(select email from beta_leads where id=d.lead_id) email,(select first_name from beta_leads where id=d.lead_id) first_name`, [Math.min(Math.max(limit, 1), 100)]);
    await client.query("commit");
    for (const delivery of claimed.rows) {
      const appUrl = process.env.APP_URL?.replace(/\/$/, "");
      if (!appUrl) throw new Error("APP_URL doit être configurée.");
      try { const token = createUnsubscribeToken(delivery.lead_id); const unsubscribeUrl = `${appUrl}/api/acquisition/unsubscribe?token=${encodeURIComponent(token)}`; const content = acquisitionTemplate(delivery.email_type, delivery.first_name, unsubscribeUrl); const result = await sendAcquisitionEmail({ to: delivery.email, ...content, unsubscribeUrl }); await client.query("update acquisition_email_deliveries set status='sent',sent_at=now(),provider_message_id=$1,last_error=null,updated_at=now() where id=$2 and status='sending'", [result.providerMessageId, delivery.id]); sent += 1; } catch (error) { await client.query("update acquisition_email_deliveries set status='failed',last_error=$1,updated_at=now() where id=$2 and status='sending'", [error instanceof Error ? error.message.slice(0, 1000) : "Échec Resend", delivery.id]); failed += 1; }
    }
    return { sent, failed };
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
}

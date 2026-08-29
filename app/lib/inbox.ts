import { database } from "./database";
import { processRecordedActivity, recordActivity } from "./activities";
import type { WorkspaceContext } from "./workspace-context";

export type InboxChannel="linkedin"|"whatsapp"|"email";
export type InboxAttachment={id:string;type:string;mimetype?:string;fileSize?:number;fileName?:string;width?:number;height?:number;duration?:number;voiceNote?:boolean};
export type InboxMessage={id:string;body:string;direction:"inbound"|"outbound";status:"draft"|"received"|"pending"|"sent"|"delivered"|"failed"|"read";createdAt:string;attachments?:InboxAttachment[]};
export type InboxConversation={id:string;contactId?:string;contactName?:string;company?:string;channel:InboxChannel;subject?:string;archived:boolean;unread:boolean;lastMessageAt?:string;messages:InboxMessage[]};
export type CreateConversationInput={contactIds:string[];channel:InboxChannel;subject?:string;initialMessage?:{body:string;direction:"inbound"|"outbound";status?:"received"|"draft"};};
async function activity(c:WorkspaceContext,id:string,event:string){return recordActivity(c,{eventType:event,entityType:"conversation",entityId:id,metadata:{conversationId:id}});}
async function owned(c:WorkspaceContext,id:string){const r=await database.query<{id:string}>(`select id from conversations where workspace_id=$1 and id=$2`,[c.workspaceId,id]);return Boolean(r.rows[0]);}

function attachmentsFromMetadata(metadata:unknown):InboxAttachment[]|undefined{
  const list=(metadata as {attachments?:InboxAttachment[]}|null)?.attachments;
  return list?.length?list:undefined;
}

// The list only carries the latest message (for the preview line and the
// Thread.latest computation in InboxClient), not the full history — the
// active conversation's full messages are fetched separately via
// getConversation() once selected, so the list stays cheap regardless of
// how long individual conversations get.
// Sorted/displayed by messages.effective_time (a stored generated column —
// see migration 012 — equal to coalesce(sent_at,received_at,created_at)),
// not bare created_at: created_at is when Talvia's own row was written (e.g.
// by a historical backfill, all at once, in whatever order the provider
// paged results), not when the message was actually sent — sorting by it
// turned a resynced conversation's real chronology into near-arbitrary
// insertion order, which read as "newest on top" once enough rows shared one
// instant. Storing it as a generated column (rather than repeating the
// coalesce() expression in every query) is what makes it indexable —
// messages_conversation_effective_idx covers both this lateral "last
// message" lookup and getConversation()'s paginated history scan below.
export async function listConversations(c:WorkspaceContext,archived=false){const r=await database.query<{id:string;contact_id:string|null;display_name:string|null;company:string|null;channel_type:InboxChannel;subject:string|null;archived_at:string|null;last_message_at:string|null;last_read_at:string|null;last_message_id:string|null;last_message_body:string|null;last_message_direction:"inbound"|"outbound"|null;last_message_status:InboxMessage["status"]|null;last_message_created_at:string|null}>(`select v.id,p.contact_id,ct.display_name,co.name company,v.channel_type,v.subject,v.archived_at,v.last_message_at,s.last_read_at,lm.id last_message_id,lm.body last_message_body,lm.direction last_message_direction,lm.status last_message_status,lm.effective_time last_message_created_at from conversations v left join lateral(select contact_id from conversation_participants where conversation_id=v.id and contact_id is not null limit 1)p on true left join contacts ct on ct.id=p.contact_id left join companies co on co.id=ct.company_id left join conversation_member_states s on s.conversation_id=v.id and s.user_id=$2 left join lateral(select id,body,direction,status,effective_time from messages where conversation_id=v.id and status!='draft' order by effective_time desc limit 1)lm on true where v.workspace_id=$1 and (v.archived_at is not null)=$3 order by v.last_message_at desc nulls last`,[c.workspaceId,c.userId,archived]);return r.rows.map(x=>({id:x.id,contactId:x.contact_id??undefined,contactName:x.display_name??undefined,company:x.company??undefined,channel:x.channel_type,subject:x.subject??undefined,archived:Boolean(x.archived_at),unread:Boolean(x.last_message_at&&(!x.last_read_at||x.last_message_at>x.last_read_at)),lastMessageAt:x.last_message_at??undefined,messages:x.last_message_id?[{id:x.last_message_id,body:x.last_message_body!,direction:x.last_message_direction!,status:x.last_message_status!,createdAt:x.last_message_created_at!}]:[]}));}

export const MESSAGE_PAGE_SIZE=40;

// Previously called listConversations() (a full-workspace lateral-join scan
// across every conversation) just to read ONE conversation's metadata, then
// fetched every single message in the thread with no LIMIT at all — the
// classic "fetch everything, every time" pattern. Replaced with one scoped
// query for the conversation itself plus a cursor-paginated message page
// (most recent MESSAGE_PAGE_SIZE by default, reversed to oldest-first for
// display; pass `before` — the oldest loaded message's createdAt — to page
// further back on scroll-up).
export async function getConversation(c:WorkspaceContext,id:string,opts?:{limit?:number;before?:string}){
  const base=await database.query<{id:string;contact_id:string|null;display_name:string|null;company:string|null;channel_type:InboxChannel;subject:string|null;archived_at:string|null;last_message_at:string|null;last_read_at:string|null}>(
    `select v.id,p.contact_id,ct.display_name,co.name company,v.channel_type,v.subject,v.archived_at,v.last_message_at,s.last_read_at
     from conversations v
     left join lateral(select contact_id from conversation_participants where conversation_id=v.id and contact_id is not null limit 1)p on true
     left join contacts ct on ct.id=p.contact_id
     left join companies co on co.id=ct.company_id
     left join conversation_member_states s on s.conversation_id=v.id and s.user_id=$2
     where v.workspace_id=$1 and v.id=$3`,
    [c.workspaceId,c.userId,id],
  );
  const row=base.rows[0];
  if(!row)return null;

  const limit=Math.min(Math.max(Math.trunc(opts?.limit??MESSAGE_PAGE_SIZE),1),200);
  const params:unknown[]=[c.workspaceId,id,limit+1];
  const beforeClause=opts?.before?(params.push(opts.before),`and effective_time<$${params.length}`):"";
  const messagesResult=await database.query<{id:string;body:string;direction:"inbound"|"outbound";status:InboxMessage["status"];effective_time:string;metadata:unknown}>(
    `select id,body,direction,status,effective_time,metadata from messages where workspace_id=$1 and conversation_id=$2 ${beforeClause} order by effective_time desc limit $3`,
    params,
  );
  const hasMoreMessages=messagesResult.rows.length>limit;
  const page=messagesResult.rows.slice(0,limit).reverse();

  return {
    id:row.id,contactId:row.contact_id??undefined,contactName:row.display_name??undefined,company:row.company??undefined,
    channel:row.channel_type,subject:row.subject??undefined,archived:Boolean(row.archived_at),
    unread:Boolean(row.last_message_at&&(!row.last_read_at||row.last_message_at>row.last_read_at)),
    lastMessageAt:row.last_message_at??undefined,
    hasMoreMessages,
    messages:page.map(x=>({id:x.id,body:x.body,direction:x.direction,status:x.status,createdAt:x.effective_time,attachments:attachmentsFromMetadata(x.metadata)})),
  };
}

// Lighter sibling of getConversation() for "load older messages" pagination
// once a thread is already open — no conversation-metadata rejoin, just the
// next page. Kept separate so InboxClient's scroll-triggered pagination
// doesn't re-fetch (and re-render) the contact/company header every time.
export async function getConversationMessages(c:WorkspaceContext,id:string,opts:{limit?:number;before?:string}){
  if(!await owned(c,id))return null;
  const limit=Math.min(Math.max(Math.trunc(opts.limit??MESSAGE_PAGE_SIZE),1),200);
  const params:unknown[]=[c.workspaceId,id,limit+1];
  const beforeClause=opts.before?(params.push(opts.before),`and effective_time<$${params.length}`):"";
  const result=await database.query<{id:string;body:string;direction:"inbound"|"outbound";status:InboxMessage["status"];effective_time:string;metadata:unknown}>(
    `select id,body,direction,status,effective_time,metadata from messages where workspace_id=$1 and conversation_id=$2 ${beforeClause} order by effective_time desc limit $3`,
    params,
  );
  const hasMoreMessages=result.rows.length>limit;
  const page=result.rows.slice(0,limit).reverse();
  return {hasMoreMessages,messages:page.map(x=>({id:x.id,body:x.body,direction:x.direction,status:x.status,createdAt:x.effective_time,attachments:attachmentsFromMetadata(x.metadata)}))};
}

// Lightweight incremental sync for the currently-open thread: messages
// strictly after `after` (the last message already held client-side), used
// to fold in new activity without re-fetching/re-rendering the whole
// conversation. See section 11 of the Inbox sprint — new messages must not
// force a full Inbox reload.
export async function getConversationMessagesSince(c:WorkspaceContext,id:string,after:string){
  if(!await owned(c,id))return null;
  const result=await database.query<{id:string;body:string;direction:"inbound"|"outbound";status:InboxMessage["status"];effective_time:string;metadata:unknown}>(
    `select id,body,direction,status,effective_time,metadata from messages where workspace_id=$1 and conversation_id=$2 and effective_time>$3 order by effective_time asc`,
    [c.workspaceId,id,after],
  );
  return result.rows.map(x=>({id:x.id,body:x.body,direction:x.direction,status:x.status,createdAt:x.effective_time,attachments:attachmentsFromMetadata(x.metadata)}));
}
export async function createConversation(c:WorkspaceContext,i:CreateConversationInput){if(!i.contactIds.length)throw new Error("Sélectionnez au moins un contact.");const client=await database.connect();try{await client.query("begin");for(const id of [...new Set(i.contactIds)]){const q=await client.query(`select id from contacts where workspace_id=$1 and id=$2 and archived_at is null`,[c.workspaceId,id]);if(!q.rowCount)throw new Error("Contact introuvable ou archivé.");}const row=await client.query<{id:string}>(`insert into conversations(workspace_id,channel_type,subject,status) values($1,$2,$3,'open') returning id`,[c.workspaceId,i.channel,i.subject??null]);const id=row.rows[0]!.id;for(const contactId of [...new Set(i.contactIds)])await client.query(`insert into conversation_participants(conversation_id,contact_id,external_participant_id,role) values($1,$2,$3,'recipient')`,[id,contactId,contactId]);if(i.initialMessage)await client.query(`insert into messages(workspace_id,conversation_id,direction,body,status,received_at) values($1,$2,$3,$4,$5,case when $3='inbound' then now() else null end)`,[c.workspaceId,id,i.initialMessage.direction,i.initialMessage.body,i.initialMessage.status??"received"]);await client.query(`update conversations set last_message_at=now() where id=$1`,[id]);await client.query("commit");await activity(c,id,"conversation.created");return getConversation(c,id);}catch(e){await client.query("rollback");throw e;}finally{client.release();}}
export async function createDraft(c:WorkspaceContext,id:string,body:string,source:"user"|"automation"="user",automationRunId?:string){if(!await owned(c,id))return null;const r=await database.query<{id:string;created_at:string}>(`insert into messages(workspace_id,conversation_id,direction,body,status) values($1,$2,'outbound',$3,'draft') returning id,created_at`,[c.workspaceId,id,body.trim()]);await recordActivity(c,{eventType:"message.draft_created",entityType:"conversation",entityId:id,metadata:{conversationId:id},source,automationRunId});return {id:r.rows[0]!.id,body:body.trim(),direction:"outbound" as const,status:"draft" as const,createdAt:r.rows[0]!.created_at};}
export async function createTestInbound(c:WorkspaceContext,id:string,body:string,providerMessageId?:string){if(!await owned(c,id))return null;const r=await database.query<{id:string;created_at:string}>(`insert into messages(workspace_id,conversation_id,direction,body,status,provider_message_id,received_at) values($1,$2,'inbound',$3,'received',$4,now()) on conflict(conversation_id,provider_message_id) where provider_message_id is not null do nothing returning id,created_at`,[c.workspaceId,id,body.trim(),providerMessageId??null]);if(!r.rowCount)return {duplicate:true};await database.query(`update conversations set last_message_at=now(),updated_at=now() where id=$1`,[id]);const event=await activity(c,id,"message.received");await processRecordedActivity(event);return {id:r.rows[0]!.id,body:body.trim(),direction:"inbound" as const,status:"received" as const,createdAt:r.rows[0]!.created_at};}
export async function setRead(c:WorkspaceContext,id:string,read:boolean){if(!await owned(c,id))return null;await database.query(`insert into conversation_member_states(conversation_id,user_id,last_read_at) values($1,$2,$3) on conflict(conversation_id,user_id) do update set last_read_at=$3,updated_at=now()`,[id,c.userId,read?new Date().toISOString():null]);return getConversation(c,id);}
export async function archive(c:WorkspaceContext,id:string,archived:boolean){const r=await database.query(`update conversations set archived_at=case when $1 then now() else null end,updated_at=now() where workspace_id=$2 and id=$3 returning id`,[archived,c.workspaceId,id]);if(!r.rowCount)return null;await activity(c,id,archived?"conversation.archived":"conversation.reopened");return getConversation(c,id);}

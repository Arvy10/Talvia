import { database } from "../../lib/database";
import { getConversation, listConversations, type InboxConversation } from "../../lib/inbox";
import { listContacts } from "../../lib/contacts";
import { listOpportunities } from "../../lib/opportunities";
import { getCurrentWorkspace } from "../../lib/workspace-context";
import { InboxClient, type InboxInitialData } from "./InboxClient";

// Every other screen in this app is client-fetch-driven (mount, then fetch,
// then render) — Inbox was no exception, which is exactly why opening it
// showed an empty shell for a beat before anything appeared. This is the one
// route that now fetches on the server: the conversation list, the most
// likely conversation to be opened (the most recent one — same one
// `InboxClient` would default to), contacts, opportunities and connection
// status all arrive already embedded in the first response, so the
// structure renders with real data instead of empty arrays.
//
// getCurrentWorkspace() throws for a session-less request; every other page
// in this app is purely client-auth-gated (no middleware, no server
// redirect), so a hard failure here would be a new, inconsistent failure
// mode for that same case. Falling back to no initial data preserves
// today's exact behavior for it — InboxClient's own client-side fetches take
// over exactly as before.
export default async function InboxPage() {
  let initialData: InboxInitialData | undefined;
  try {
    const context = await getCurrentWorkspace();
    const [conversations, contacts, opportunities, connectionsResult] = await Promise.all([
      listConversations(context, false),
      listContacts(context),
      listOpportunities(context),
      database.query<{ channel_type: "linkedin" | "whatsapp" | "email"; status: string }>(
        `select channel_type,status from connections where workspace_id=$1`,
        [context.workspaceId],
      ),
    ]);

    const mostRecent = conversations[0];
    let activeConversation: InboxConversation & { hasMoreMessages?: boolean } | null = null;
    if (mostRecent) {
      activeConversation = await getConversation(context, mostRecent.id);
    }

    // pg returns timestamptz columns as Date objects, and React Server
    // Components' flight protocol would happily hand a live Date instance
    // to the client — but every existing client-side fetch got its
    // timestamps through NextResponse.json(), which always stringifies
    // Dates to ISO 8601. A JSON round-trip here keeps this prop shape
    // byte-identical to that, so query-string cursors built from
    // `message.createdAt` (pagination's `before`, polling's `since`) stay
    // valid ISO strings instead of Date#toString()'s non-ISO format.
    initialData = JSON.parse(JSON.stringify({
      conversations: activeConversation
        ? conversations.map((conversation) => (conversation.id === activeConversation!.id ? { ...activeConversation!, hasMoreMessages: activeConversation!.hasMoreMessages ?? false } : conversation))
        : conversations,
      contacts,
      opportunities,
      connections: connectionsResult.rows,
      activeConversationId: activeConversation?.id ?? null,
    }));
  } catch {
    initialData = undefined;
  }

  return <InboxClient initialData={initialData} />;
}

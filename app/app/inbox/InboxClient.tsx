"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  LuArrowLeft,
  LuArrowRight,
  LuBot,
  LuCheck,
  LuCheckCheck,
  LuCircleAlert,
  LuClock,
  LuFile,
  LuInbox,
  LuMessageCircle,
  LuPencil,
  LuPlus,
  LuSearch,
  LuUserRound,
} from "react-icons/lu";
import SendIcon from "../components/icons/SendIcon";
import SparklesIcon from "../components/icons/SparklesIcon";
import { Dialog } from "../components/Dialog";
import { EmptyState } from "../components/ui";
import { ChannelLogo } from "../connections/ChannelLogo";
import type { ChannelId, Contact, Opportunity } from "../state/types";
import { apiChannelToUi, channelMap, uiChannelToApi } from "./inbox-model";
import { generateReply, type ReplyMode } from "./talvia-ai";

type ApiConnection = { channel_type: "linkedin" | "whatsapp" | "email"; status: string };

type ApiAttachment = {
  id: string;
  type: string;
  mimetype?: string;
  fileSize?: number;
  fileName?: string;
  width?: number;
  height?: number;
  duration?: number;
  voiceNote?: boolean;
};

type MessageStatusValue = "draft" | "pending" | "sent" | "delivered" | "failed" | "read" | "received" | "sending";

type ApiMessage = {
  id: string;
  body: string;
  direction: "inbound" | "outbound";
  status: MessageStatusValue;
  createdAt: string;
  attachments?: ApiAttachment[];
};
type ApiConversation = {
  id: string;
  contactId?: string;
  contactName?: string;
  company?: string;
  channel: "linkedin" | "whatsapp" | "email";
  subject?: string;
  archived: boolean;
  unread: boolean;
  lastMessageAt?: string;
  messages: ApiMessage[];
  hasMoreMessages?: boolean;
};
type Thread = ApiConversation & { key: string; latest?: ApiMessage };

export type InboxInitialData = {
  conversations: ApiConversation[];
  contacts: Contact[];
  opportunities: Opportunity[];
  connections: ApiConnection[];
  activeConversationId: string | null;
};

const NEAR_BOTTOM_THRESHOLD = 120;
const LOAD_OLDER_THRESHOLD = 80;
const POLL_INTERVAL_MS = 20_000;

function isSameDay(a: string, b: string) {
  const dateA = new Date(a);
  const dateB = new Date(b);
  return dateA.toDateString() === dateB.toDateString();
}

function dateSeparatorLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Aujourd’hui";
  if (date.toDateString() === yesterday.toDateString()) return "Hier";
  return date.toLocaleDateString("fr", { day: "numeric", month: "long", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function formatFileSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

function formatDuration(seconds?: number) {
  if (seconds == null) return "";
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${secs}`;
}

// URLs become clickable without dangerouslySetInnerHTML: split() with a
// capturing group always interleaves matched delimiters at odd indices, so
// there's no need to re-run the (stateful, /g-flagged) pattern with .test()
// against each part — a classic footgun when the same regex object is
// reused across calls in a loop.
const URL_PATTERN = /(https?:\/\/[^\s<]+)/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]'"]+$/;

function linkifyText(text: string): ReactNode[] {
  if (!text) return [];
  const parts = text.split(URL_PATTERN);
  return parts.flatMap((part, index) => {
    if (index % 2 === 0) return part ? [<Fragment key={index}>{part}</Fragment>] : [];
    const trailingMatch = part.match(TRAILING_PUNCTUATION);
    const trailing = trailingMatch ? trailingMatch[0] : "";
    const url = trailing ? part.slice(0, -trailing.length) : part;
    if (!url) return trailing ? [trailing] : [];
    return [
      <a href={url} key={index} rel="noopener noreferrer" target="_blank">{url}</a>,
      trailing,
    ].filter(Boolean);
  });
}

function MessageStatus({ status }: { status: MessageStatusValue }) {
  if (status === "read") return <LuCheckCheck aria-label="Lu" className="inbox-message__status inbox-message__status--read" />;
  if (status === "delivered") return <LuCheckCheck aria-label="Distribué" className="inbox-message__status" />;
  if (status === "sent") return <LuCheck aria-label="Envoyé" className="inbox-message__status" />;
  if (status === "failed") return <LuCircleAlert aria-label="Échec" className="inbox-message__status inbox-message__status--failed" />;
  return <LuClock aria-label="En cours" className="inbox-message__status" />;
}

function ContactAvatar({ contact, large }: { contact?: Pick<Contact, "name" | "avatarUrl">; large?: boolean }) {
  const className = large ? "inbox-avatar inbox-avatar--large" : "inbox-avatar";
  if (contact?.avatarUrl) {
    return <span className={className}><img alt="" src={contact.avatarUrl} /></span>;
  }
  return <span className={className}>{contact?.name.slice(0, 2).toUpperCase() ?? "?"}</span>;
}

function MessageAttachment({ attachment, messageId }: { attachment: ApiAttachment; messageId: string }) {
  // Real message ids only — an optimistic/temp id has nothing to proxy yet.
  if (messageId.startsWith("temp-")) return null;
  const src = `/api/inbox/attachments/${messageId}/${attachment.id}`;

  if (attachment.type === "img") {
    return (
      <a className="inbox-attachment inbox-attachment--image" href={src} rel="noopener noreferrer" target="_blank">
        <img alt="Image partagée" loading="lazy" src={src} />
      </a>
    );
  }
  if (attachment.type === "video") {
    return <video className="inbox-attachment inbox-attachment--video" controls src={src} />;
  }
  if (attachment.type === "audio") {
    return (
      <div className="inbox-attachment inbox-attachment--audio">
        <audio controls preload="none" src={src} />
        {attachment.duration != null ? (
          <span>{attachment.voiceNote ? "Note vocale · " : ""}{formatDuration(attachment.duration)}</span>
        ) : null}
      </div>
    );
  }
  if (attachment.type === "file") {
    return (
      <a className="inbox-attachment inbox-attachment--file" download href={src} rel="noopener noreferrer">
        <LuFile aria-hidden="true" />
        <span>
          <strong>{attachment.fileName ?? "Document"}</strong>
          {attachment.fileSize ? <small>{formatFileSize(attachment.fileSize)}</small> : null}
        </span>
      </a>
    );
  }
  return <span className="inbox-attachment inbox-attachment--unsupported">Pièce jointe non prise en charge</span>;
}

function ThreadListSkeleton() {
  return (
    <div className="inbox-dense-threads" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="inbox-dense-thread inbox-skeleton-row" key={index}>
          <span className="inbox-skeleton inbox-skeleton--avatar" />
          <span>
            <span className="inbox-skeleton inbox-skeleton--line" style={{ width: "70%" }} />
            <span className="inbox-skeleton inbox-skeleton--line" style={{ width: "45%" }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function MessagesSkeleton() {
  return (
    <div className="inbox-messages-skeleton" aria-hidden="true">
      {[38, 62, 30, 70, 48].map((width, index) => (
        <span className={`inbox-skeleton inbox-skeleton--bubble ${index % 2 === 0 ? "is-inbound" : "is-outbound"}`} key={index} style={{ width: `${width}%` }} />
      ))}
    </div>
  );
}

export function InboxClient({ initialData }: { initialData?: InboxInitialData }) {
  const router = useRouter();
  const [conversations, setConversations] = useState<ApiConversation[]>(initialData?.conversations ?? []);
  const [contacts, setContacts] = useState<Contact[]>(initialData?.contacts ?? []);
  const [opportunities, setOpportunities] = useState<Opportunity[]>(initialData?.opportunities ?? []);
  const [newOpen, setNewOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [contactId, setContactId] = useState("");
  const [channel, setChannel] = useState<ChannelId | "">("");
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<ChannelId | "all">("all");
  const [search, setSearch] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(initialData?.activeConversationId ?? null);
  const [mobileView, setMobileView] = useState<"list" | "chat" | "context">(
    "list",
  );
  const [error, setError] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [connectedChannels, setConnectedChannels] = useState<Set<ChannelId> | null>(
    initialData ? new Set(initialData.connections.filter((item) => item.status === "connected").map((item) => apiChannelToUi(item.channel_type))) : null,
  );
  const [hasFetchedOnce, setHasFetchedOnce] = useState(Boolean(initialData));
  const [openingConversationId, setOpeningConversationId] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [showNewMessagePill, setShowNewMessagePill] = useState(false);
  const [scrollToBottomToken, setScrollToBottomToken] = useState(0);

  // Which conversations already hold a full, paginated message page —
  // switching back to one of these must not refetch (tic-tac navigation,
  // not a reload every time); a background poll keeps it fresh instead.
  const loadedConversationsRef = useRef<Set<string>>(new Set(initialData?.activeConversationId ? [initialData.activeConversationId] : []));
  const conversationsRef = useRef(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  });

  const refresh = async (archived = false) => {
    const [a, b, c] = await Promise.all([
      fetch(`/api/inbox/conversations?archived=${archived}`),
      fetch("/api/contacts"),
      fetch("/api/opportunities"),
    ]);
    if (!a.ok || !b.ok || !c.ok) {
      setError("Impossible de charger l’Inbox.");
      return;
    }
    const freshConversations = ((await a.json()) as { conversations: ApiConversation[] }).conversations;
    // The list endpoint only carries a one-message preview per conversation
    // — naively replacing state with it would erase any conversation whose
    // full history is already loaded (every poll tick, every background
    // refresh after sending). Keep the loaded messages/pagination cursor for
    // anything already fetched; only the preview-only fields get refreshed.
    setConversations((current) =>
      freshConversations.map((fresh) => {
        const existing = current.find((item) => item.id === fresh.id);
        return existing && loadedConversationsRef.current.has(fresh.id)
          ? { ...fresh, messages: existing.messages, hasMoreMessages: existing.hasMoreMessages }
          : fresh;
      }),
    );
    setContacts(((await b.json()) as { contacts: Contact[] }).contacts);
    setOpportunities(((await c.json()) as { opportunities: Opportunity[] }).opportunities);
    setHasFetchedOnce(true);
  };
  useEffect(() => {
    if (!initialData) void refresh();
    if (!initialData) {
      void fetch("/api/connections").then((response) => (response.ok ? response.json() : null)).then((data: { connections: ApiConnection[] } | null) => {
        const connected = (data?.connections ?? []).filter((item) => item.status === "connected").map((item) => apiChannelToUi(item.channel_type));
        setConnectedChannels(new Set(connected));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const threads = useMemo(
    () =>
      conversations
        .map((conversation): Thread => ({
          ...conversation,
          key: conversation.id,
          latest: [...conversation.messages]
            .filter((m) => m.status !== "draft")
            .at(-1),
        }))
        .filter(
          (thread) =>
          (filter === "all" || apiChannelToUi(thread.channel) === filter) &&
            (!search ||
              `${thread.contactName ?? ""} ${thread.company ?? ""} ${thread.latest?.body ?? ""}`
                .toLowerCase()
                .includes(search.toLowerCase())),
        ),
    [conversations, filter, search],
  );
  const activeThread =
    threads.find((thread) => thread.id === activeKey) ?? threads[0] ?? null;
  const threadMessages = activeThread?.messages ?? [];
  const activeContact = contacts.find(
    (contact) => contact.id === activeThread?.contactId,
  );

  // Fetches the most recent message page for a conversation that hasn't
  // been opened yet this session — never the full-conversation route (that
  // one also rejoins contact/company metadata the list preview already
  // has). Skips entirely for anything already cached.
  const loadThreadMessages = async (conversationId: string) => {
    setOpeningConversationId(conversationId);
    try {
      const response = await fetch(`/api/inbox/conversations/${conversationId}/messages`);
      if (!response.ok) return;
      const data = (await response.json()) as { messages: ApiMessage[]; hasMoreMessages: boolean };
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, messages: data.messages, hasMoreMessages: data.hasMoreMessages }
            : conversation,
        ),
      );
      loadedConversationsRef.current.add(conversationId);
    } finally {
      setOpeningConversationId((current) => (current === conversationId ? null : current));
    }
  };
  useEffect(() => {
    if (activeThread && !loadedConversationsRef.current.has(activeThread.id)) void loadThreadMessages(activeThread.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.id]);

  // A ref guard, not just the `loadingOlder` state: `onScroll` can fire
  // several times before a state update from the first call has committed,
  // and a state check alone wouldn't catch a call that starts in that gap —
  // re-entering here would send two overlapping `before=` requests and
  // prepend the same page of history twice.
  const loadingOlderRef = useRef(false);
  const loadOlderMessages = async () => {
    if (!activeThread || loadingOlderRef.current || !activeThread.hasMoreMessages) return;
    const oldest = activeThread.messages[0];
    if (!oldest) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const node = messageScrollRef.current;
    pendingOlderLoadRef.current = node ? { prevScrollHeight: node.scrollHeight } : null;
    try {
      const response = await fetch(`/api/inbox/conversations/${activeThread.id}/messages?before=${encodeURIComponent(oldest.createdAt)}`);
      if (!response.ok) return;
      const data = (await response.json()) as { messages: ApiMessage[]; hasMoreMessages: boolean };
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === activeThread.id
            ? { ...conversation, messages: [...data.messages, ...conversation.messages], hasMoreMessages: data.hasMoreMessages }
            : conversation,
        ),
      );
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  };

  const messageScrollRef = useRef<HTMLDivElement>(null);
  const pendingOlderLoadRef = useRef<{ prevScrollHeight: number } | null>(null);
  const previousActiveIdRef = useRef<string | null>(initialData?.activeConversationId ?? null);
  const previousMobileViewRef = useRef(mobileView);
  const prevMessageCountRef = useRef(threadMessages.length);

  // Scroll handling is the make-or-break of a chat UI: open a thread and
  // land on the newest message immediately (useLayoutEffect — runs before
  // paint, so there's no visible flash-then-jump); load older history
  // without ever teleporting the reader (restore scrollTop from the
  // captured pre-load scrollHeight); and only auto-scroll a live incoming
  // message if the reader is already near the bottom — otherwise surface a
  // "nouveaux messages" pill instead of yanking them down mid-read.
  useLayoutEffect(() => {
    const node = messageScrollRef.current;
    if (!node) return;

    if (pendingOlderLoadRef.current) {
      const { prevScrollHeight } = pendingOlderLoadRef.current;
      node.scrollTop = node.scrollHeight - prevScrollHeight;
      pendingOlderLoadRef.current = null;
      prevMessageCountRef.current = threadMessages.length;
      return;
    }

    // Below 1100px the chat column is `display:none` while mobileView is
    // "list" (see v2.css) — a hidden element measures scrollHeight as 0, so
    // running this on mount (while the panel is still hidden) was a no-op,
    // and nothing re-ran once the panel actually became visible on tap.
    // That's why opening a conversation on a narrow viewport landed on the
    // top instead of the bottom: the "scroll to bottom" never actually had
    // anything to measure. Treating "the panel just became visible" the
    // same as "the conversation just changed" fixes it.
    const justBecameVisible = mobileView === "chat" && previousMobileViewRef.current !== "chat";
    previousMobileViewRef.current = mobileView;

    if (activeThread?.id !== previousActiveIdRef.current || justBecameVisible) {
      node.scrollTop = node.scrollHeight;
      previousActiveIdRef.current = activeThread?.id ?? null;
      prevMessageCountRef.current = threadMessages.length;
      setIsNearBottom(true);
      setShowNewMessagePill(false);
      return;
    }

    if (threadMessages.length > prevMessageCountRef.current) {
      if (isNearBottom) {
        node.scrollTop = node.scrollHeight;
      } else {
        // Scroll position is imperative browser state that can only be read
        // after the DOM has updated — there is no render-time-derivable
        // substitute for "is the reader currently near the bottom", so this
        // genuinely has to live in a layout effect rather than be computed
        // during render.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShowNewMessagePill(true);
      }
    }
    prevMessageCountRef.current = threadMessages.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.id, threadMessages.length, mobileView]);

  // The "nouveaux messages" pill triggers this rather than writing to the
  // scroll ref directly from a click handler — keeping every DOM/ref
  // mutation inside an effect (not spread across event handlers too) is
  // what the scroll-restore effect above already does for the open/older-
  // load/live-append cases, so this stays the one place that owns it.
  useEffect(() => {
    if (scrollToBottomToken === 0) return;
    const node = messageScrollRef.current;
    // Scrolling a DOM node is exactly the kind of imperative, non-React-owned
    // mutation effects exist for — there's no pure-render alternative to
    // "move this element's scroll position".
    // eslint-disable-next-line react-hooks/immutability
    if (node) node.scrollTop = node.scrollHeight;
  }, [scrollToBottomToken]);

  const handleMessageScroll = () => {
    const node = messageScrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    const near = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;
    setIsNearBottom(near);
    if (near) setShowNewMessagePill(false);
    if (node.scrollTop < LOAD_OLDER_THRESHOLD) void loadOlderMessages();
  };

  const scrollToBottom = () => {
    setScrollToBottomToken((token) => token + 1);
    setShowNewMessagePill(false);
  };

  // Background sync for the currently-open thread and the conversation
  // list — a new incoming message shows up without a manual refresh and
  // without ever reloading the whole Inbox (only messages strictly after
  // the last one already held client-side are fetched and appended).
  useEffect(() => {
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      void refresh();
      const id = previousActiveIdRef.current;
      if (!id) return;
      const conversation = conversationsRef.current.find((item) => item.id === id);
      const last = conversation?.messages.at(-1);
      if (!last || last.id.startsWith("temp-")) return;
      const response = await fetch(`/api/inbox/conversations/${id}/messages?since=${encodeURIComponent(last.createdAt)}`).catch(() => null);
      if (!response?.ok) return;
      const data = (await response.json()) as { messages: ApiMessage[] };
      if (!data.messages.length) return;
      setConversations((current) =>
        current.map((item) =>
          item.id === id
            ? { ...item, messages: [...item.messages, ...data.messages.filter((incoming) => !item.messages.some((existing) => existing.id === incoming.id))] }
            : item,
        ),
      );
    };
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // A conversation can only start on a channel Talvia is actually connected
  // to — otherwise nothing would ever be sent, even though the contact
  // happens to have a phone number or email on file.
  const availableChannels = (contacts.find((contact) => contact.id === contactId)
    ? getContactChannels(contacts.find((contact) => contact.id === contactId)!)
    : []
  ).filter((item) => connectedChannels?.has(item));
  const opportunity = opportunities.find(
    (item) => item.contactId === activeContact?.id,
  );

  const beginConversation = async (event: FormEvent) => {
    event.preventDefault();
    if (!contactId || !channel) {
      setError("Choisissez un contact et l’un de ses canaux disponibles.");
      return;
    }
    const response = await fetch("/api/inbox/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contactIds: [contactId],
        channel: uiChannelToApi(channel),
      }),
    });
    const data = (await response.json()) as {
      conversation?: ApiConversation;
      error?: string;
    };
    if (!response.ok || !data.conversation) {
      setError(data.error ?? "Création impossible.");
      return;
    }
    loadedConversationsRef.current.add(data.conversation.id);
    setActiveKey(data.conversation.id);
    setNewOpen(false);
    setContactId("");
    setChannel("");
    setMobileView("chat");
    await refresh();
  };

  // Sends optimistically: the composer clears and the message appears
  // ("sending") in under a beat, well before the request round-trips —
  // Talvia never makes the sender wait to see their own words land. Only a
  // failure gets rewritten back, with a retry affordance, once the request
  // actually resolves.
  const postMessage = async (conversationId: string, text: string, tempId: string) => {
    try {
      const response = await fetch(`/api/inbox/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { message: ApiMessage };
      setConversations((current) =>
        current.map((conversation) => {
          if (conversation.id !== conversationId) return conversation;
          // The background poll can independently pick up this same message
          // (by its real id) via `since` before this response comes back —
          // de-dupe by id rather than a plain replace, so it doesn't end up
          // showing twice (the temp placeholder resolved here, plus a
          // separate copy the poll already appended).
          const replaced = conversation.messages.map((m) => (m.id === tempId ? data.message : m));
          const deduped = Array.from(new Map(replaced.map((m) => [m.id, m])).values());
          return { ...conversation, messages: deduped };
        }),
      );
    } catch {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, messages: conversation.messages.map((m) => (m.id === tempId ? { ...m, status: "failed" as const } : m)) }
            : conversation,
        ),
      );
    }
  };

  const performSend = async () => {
    if (!activeThread || !draft.trim()) return;
    const text = draft.trim();
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimisticMessage: ApiMessage = { id: tempId, body: text, direction: "outbound", status: "sending", createdAt: new Date().toISOString() };
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeThread.id ? { ...conversation, messages: [...conversation.messages, optimisticMessage] } : conversation,
      ),
    );
    setDraft("");
    setAiOpen(false);
    await postMessage(activeThread.id, text, tempId);
  };
  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    void performSend();
  };

  const retryMessage = async (message: ApiMessage) => {
    if (!activeThread) return;
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeThread.id
          ? { ...conversation, messages: conversation.messages.map((m) => (m.id === message.id ? { ...m, status: "sending" as const } : m)) }
          : conversation,
      ),
    );
    await postMessage(activeThread.id, message.body, message.id);
  };

  const startEditingMessage = (message: ApiMessage) => {
    setEditingMessageId(message.id);
    setEditingBody(message.body);
    setError("");
  };
  const cancelEditingMessage = () => {
    setEditingMessageId(null);
    setEditingBody("");
  };
  const saveMessageEdit = async () => {
    if (!editingMessageId || !editingBody.trim() || !activeThread) return;
    setEditSaving(true);
    try {
      const response = await fetch(`/api/inbox/messages/${editingMessageId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: editingBody }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Impossible de modifier ce message.");
        return;
      }
      const edited = editingBody.trim();
      setEditingMessageId(null);
      setEditingBody("");
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === activeThread.id
            ? { ...conversation, messages: conversation.messages.map((m) => (m.id === editingMessageId ? { ...m, body: edited } : m)) }
            : conversation,
        ),
      );
    } finally {
      setEditSaving(false);
    }
  };
  const useAi = (mode: ReplyMode) => {
    setDraft(
      generateReply(
        {
          conversation: threadMessages.map((message) => ({
            ...message,
            createdAt: message.createdAt,
            simulated: true,
            contactId: activeThread?.contactId ?? "",
            channel: activeThread ? apiChannelToUi(activeThread.channel) : "gmail",
          })),
          contact: activeContact,
          opportunity,
          currentDraft: draft,
        },
        mode,
      ),
    );
    setAiOpen(false);
  };
  const saveNote = (_value: string) => undefined;
  const createOpportunity = () => {
    if (!activeContact || !activeThread) return;
    router.push(
      `/app/opportunities?contactId=${encodeURIComponent(activeContact.id)}&conversationId=${encodeURIComponent(activeThread.id)}`,
    );
  };

  if (connectedChannels && connectedChannels.size === 0) {
    return (
      <div className="inbox-page inbox-page--center">
        <div className="inbox-no-channels">
          <h1>Boîte de réception.</h1>
          <p>Connectez un canal pour voir vos conversations ici.</p>
          <ul>
            <li>Gérez vos e-mails Gmail directement depuis Talvia</li>
            <li>Envoyez et recevez des messages LinkedIn et WhatsApp</li>
            <li>Retrouvez le contexte de chaque contact à côté de la conversation</li>
          </ul>
          <div className="inbox-no-channels__brands">
            <span>Fonctionne avec</span>
            {channelMap.map((item) => <ChannelLogo channel={item.id} key={item.id} />)}
          </div>
          <Link className="connection-button" href="/app/connections">Connecter un canal<LuArrowRight aria-hidden="true" /></Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`inbox-page inbox-page--center mobile-view-${mobileView}`}>
      <header className="inbox-compact-header">
        <div>
          <h1>Inbox</h1>
          <p>
            Retrouvez le contexte, le contact et la prochaine action derrière chaque conversation.
          </p>
        </div>
        <button
          className="connection-button"
          onClick={() => setNewOpen(true)}
          type="button"
        >
          <LuPlus />
          Nouvelle conversation
        </button>
      </header>
      <section className="talvia-inbox-layout">
        <aside className="talvia-inbox-list">
          <div className="inbox-list-heading">
            <strong>Conversations</strong>
            <span>{threads.length}</span>
          </div>
          <label className="inbox-dense-search">
            <LuSearch />
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher..."
              value={search}
            />
          </label>
          <div className="inbox-brand-filters">
            <button
              className={filter === "all" ? "is-active" : undefined}
              onClick={() => setFilter("all")}
              type="button"
            >
              Toutes
            </button>
            {channelMap.map((item) => (
              <button
                aria-label={item.label}
                className={filter === item.id ? "is-active" : undefined}
                key={item.id}
                onClick={() => setFilter(item.id)}
                title={item.label}
                type="button"
              >
                <ChannelLogo channel={item.id} />
              </button>
            ))}
          </div>
          {!hasFetchedOnce ? (
            <ThreadListSkeleton />
          ) : threads.length === 0 ? (
            <EmptyState
              className="inbox-dense-empty"
              icon={<LuInbox />}
              title="Aucune conversation pour le moment"
              description="Démarrez une conversation avec un contact ou retrouvez ici les réponses issues de votre suivi commercial."
              action={
                <button
                  className="connection-button connection-button--secondary"
                  onClick={() => setNewOpen(true)}
                  type="button"
                >
                  Nouvelle conversation
                </button>
              }
            />
          ) : (
            <div className="inbox-dense-threads">
              {threads.map((thread) => {
                const contact = contacts.find(
                  (item) => item.id === thread.contactId,
                );
                return (
                  <button
                    className={
                      activeThread?.key === thread.key
                        ? "inbox-dense-thread is-active"
                        : "inbox-dense-thread"
                    }
                    key={thread.key}
                    onClick={() => {
                      setActiveKey(thread.key);
                      setMobileView("chat");
                    }}
                    type="button"
                  >
                    <ContactAvatar contact={contact} />
                    <span>
                      <strong>{contact?.name ?? "Contact"}</strong>
                      <small>
                        {contact?.company ??
                          channelMap.find((item) => item.id === thread.channel)
                            ?.label}
                      </small>
                      <p>
                        {thread.latest?.body || (thread.latest?.attachments?.length ? "Pièce jointe" : "Aucun message pour le moment")}
                      </p>
                    </span>
                    <span className="inbox-thread-meta">
                      <ChannelLogo channel={apiChannelToUi(thread.channel)} />
                      <time>
                        {thread.latest
                          ? new Date(
                              thread.latest.createdAt,
                            ).toLocaleTimeString("fr", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </time>
                      {thread.latest?.direction === "inbound" ? <i /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>
        <section className="talvia-inbox-chat">
          <header className="inbox-chat-heading">
            <button
              className="inbox-mobile-control"
              onClick={() => setMobileView("list")}
              type="button"
            >
              <LuArrowLeft />
            </button>
            {activeContact && activeThread ? (
              <>
                <div className="inbox-chat-person">
                  <ContactAvatar contact={activeContact} />
                  <span>
                    <strong>{activeContact.name}</strong>
                    <small>
                      <ChannelLogo channel={apiChannelToUi(activeThread.channel)} />
                      {
                        channelMap.find(
                          (item) => item.id === activeThread.channel,
                        )?.label
                      }
                    </small>
                  </span>
                </div>
                <div className="inbox-chat-actions">
                  <button
                    onClick={() => setMobileView("context")}
                    type="button"
                  >
                    <LuUserRound />
                    <span>Contexte</span>
                  </button>
                </div>
              </>
            ) : (
              <strong>Conversation</strong>
            )}
          </header>
          <div className="inbox-message-scroll" onScroll={handleMessageScroll} ref={messageScrollRef}>
            {!hasFetchedOnce ? (
              <MessagesSkeleton />
            ) : !activeThread ? (
              <EmptyState
                icon={<LuMessageCircle />}
                title="Sélectionnez une conversation"
                description="Choisissez un échange ou démarrez une nouvelle conversation."
              />
            ) : openingConversationId === activeThread.id ? (
              <MessagesSkeleton />
            ) : threadMessages.length === 0 ? (
              <div className="inbox-conversation-empty">
                <LuMessageCircle />
                <h2>Aucun message pour le moment</h2>
                <p>Commencez la conversation avec ce contact.</p>
              </div>
            ) : (
              <>
                {loadingOlder ? <div className="inbox-older-loading">Chargement des messages précédents...</div> : null}
                {threadMessages.map((message, index) => {
                  const previous = threadMessages[index - 1];
                  const showDateSeparator = !previous || !isSameDay(previous.createdAt, message.createdAt);
                  return (
                    <Fragment key={message.id}>
                      {showDateSeparator ? (
                        <div className="inbox-date-separator">
                          <span>{dateSeparatorLabel(message.createdAt)}</span>
                        </div>
                      ) : null}
                      <div className={`inbox-message inbox-message--${message.direction}`}>
                        {editingMessageId === message.id ? (
                          <div className="inbox-message-edit">
                            <textarea
                              autoFocus
                              onChange={(event) => setEditingBody(event.target.value)}
                              rows={2}
                              value={editingBody}
                            />
                            <div className="inbox-message-edit__actions">
                              <button
                                disabled={editSaving}
                                onClick={cancelEditingMessage}
                                type="button"
                              >
                                Annuler
                              </button>
                              <button
                                className="is-primary"
                                disabled={editSaving || !editingBody.trim()}
                                onClick={() => void saveMessageEdit()}
                                type="button"
                              >
                                {editSaving ? "Enregistrement..." : "Enregistrer"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {message.attachments?.length ? (
                              <div className="inbox-message-attachments">
                                {message.attachments.map((attachment) => (
                                  <MessageAttachment attachment={attachment} key={attachment.id} messageId={message.id} />
                                ))}
                              </div>
                            ) : null}
                            {message.body ? <p>{linkifyText(message.body)}</p> : null}
                            {message.direction === "outbound" && message.status !== "sending" && message.status !== "failed" ? (
                              <button
                                aria-label="Modifier ce message"
                                className="inbox-message__edit-trigger"
                                onClick={() => startEditingMessage(message)}
                                type="button"
                              >
                                <LuPencil aria-hidden="true" />
                              </button>
                            ) : null}
                          </>
                        )}
                        <span>
                          {new Date(message.createdAt).toLocaleTimeString("fr", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {message.direction === "outbound" ? <MessageStatus status={message.status} /> : null}
                        </span>
                        {message.status === "failed" ? (
                          <button className="inbox-message__retry" onClick={() => void retryMessage(message)} type="button">
                            Échec de l’envoi — Réessayer
                          </button>
                        ) : null}
                      </div>
                    </Fragment>
                  );
                })}
              </>
            )}
          </div>
          {showNewMessagePill ? (
            <button className="inbox-new-message-pill" onClick={scrollToBottom} type="button">
              Nouveaux messages ↓
            </button>
          ) : null}
          {activeThread ? (
            <form className="talvia-composer" onSubmit={sendMessage}>
              <textarea
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void performSend();
                  }
                }}
                placeholder="Écrivez votre message..."
                rows={3}
                value={draft}
              />
              <div className="talvia-composer__bar">
                <div>
                  <button
                    aria-label="Ajouter une pièce jointe prochainement"
                    disabled
                    type="button"
                  >
                    <LuPlus />
                  </button>
                  <button
                    className="talvia-ai-trigger"
                    onClick={() => setAiOpen(!aiOpen)}
                    type="button"
                  >
                    <SparklesIcon aria-hidden="true" size={14} />
                    Générer avec Talvia
                  </button>
                </div>
                <button
                  className="talvia-send-button"
                  disabled={!draft.trim()}
                  type="submit"
                >
                  <SendIcon aria-hidden="true" size={14} />
                  Envoyer
                </button>
              </div>
              {aiOpen ? (
                <div className="talvia-ai-menu">
                  <div>
                    <LuBot />
                    <span>
                      <strong>Talvia peut préparer votre réponse</strong>
                      <small>Fonction IA simulée dans cet environnement.</small>
                    </span>
                  </div>
                  <div>
                    {(
                      [
                        "generate",
                        "shorter",
                        "professional",
                        "natural",
                        "warmer",
                        "direct",
                      ] as ReplyMode[]
                    ).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => useAi(mode)}
                        type="button"
                      >
                        {
                          {
                            generate: "Générer une réponse",
                            shorter: "Plus court",
                            professional: "Plus professionnel",
                            natural: "Plus naturel",
                            warmer: "Plus chaleureux",
                            direct: "Plus direct",
                          }[mode]
                        }
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </form>
          ) : null}
        </section>
        <aside className="talvia-inbox-context">
          <div className="inbox-context-mobile-heading">
            <button onClick={() => setMobileView("chat")} type="button">
              <LuArrowLeft />
              Conversation
            </button>
          </div>
          {activeContact && activeThread ? (
            <>
              <section className="inbox-contact-identity">
                <ContactAvatar contact={activeContact} large />
                <h2>{activeContact.name}</h2>
                <p>
                  {activeContact.role ?? "Fonction non renseignée"}
                  {activeContact.company ? ` · ${activeContact.company}` : ""}
                </p>
                <span className="inbox-contact-saved">
                  <LuUserRound />
                  Contact enregistré
                </span>
                <Link href="/app/contacts">Voir le contact</Link>
              </section>
              <section>
                <p className="inbox-context-label">CANAUX</p>
                <div className="inbox-context-channels">
                  {getContactChannels(activeContact).map((item) => (
                    <span key={item}>
                      <ChannelLogo channel={item} />
                      {
                        channelMap.find(
                          (channelItem) => channelItem.id === item,
                        )?.label
                      }
                    </span>
                  ))}
                </div>
              </section>
              <section>
                <p className="inbox-context-label">OPPORTUNITÉ</p>
                {opportunity ? (
                  <div className="inbox-opportunity">
                    <strong>{opportunity.title}</strong>
                    <span>{opportunity.stage}</span>
                    <Link href="/app/opportunities">Voir l’opportunité</Link>
                  </div>
                ) : (
                  <div className="inbox-no-opportunity">
                    <span>Aucune opportunité associée.</span>
                    <button onClick={createOpportunity} type="button">
                      Créer une opportunité
                    </button>
                  </div>
                )}
              </section>
              <section>
                <p className="inbox-context-label">NOTES</p>
                <textarea
                  maxLength={500}
                  onChange={(event) => saveNote(event.target.value)}
                  placeholder="Ajoutez une note commerciale..."
                  rows={6}
                  value={activeContact.notes ?? ""}
                />
              </section>
              <section className="inbox-context-data">
                <p className="inbox-context-label">COORDONNÉES</p>
                {activeThread.channel === "whatsapp" ? (
                  <span>{activeContact.phone ?? "Numéro non renseigné"}</span>
                ) : activeThread.channel === "email" ? (
                  <span>{activeContact.email ?? "Email non renseigné"}</span>
                ) : (
                  <>
                    <span>
                      {activeContact.role ?? "Fonction non renseignée"}
                    </span>
                    <span>
                      {activeContact.company ?? "Entreprise non renseignée"}
                    </span>
                  </>
                )}
              </section>
            </>
          ) : (
            <EmptyState
              icon={<LuUserRound />}
              title="Contexte commercial"
              description="Sélectionnez une conversation pour afficher le contact et les prochaines actions."
            />
          )}
        </aside>
      </section>
      <Dialog
        description="Choisissez uniquement le contact et le canal. Vous écrirez ensuite dans la conversation."
        onClose={() => {
          setNewOpen(false);
          setError("");
        }}
        open={newOpen}
        title="Nouvelle conversation"
      >
        <form className="workspace-form" onSubmit={beginConversation}>
          <label>
            <span>Contact</span>
            <select
              onChange={(event) => {
                setContactId(event.target.value);
                setChannel("");
                setError("");
              }}
              value={contactId}
            >
              <option value="">Choisir un contact</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </select>
          </label>
          {contactId ? (
            <fieldset>
              <legend>Canal disponible</legend>
              {availableChannels.length ? (
                <div className="new-conversation-channels">
                  {availableChannels.map((item) => (
                    <button
                      className={channel === item ? "is-active" : undefined}
                      key={item}
                      onClick={() => setChannel(item)}
                      type="button"
                    >
                      <ChannelLogo channel={item} />
                      {
                        channelMap.find(
                          (channelItem) => channelItem.id === item,
                        )?.label
                      }
                    </button>
                  ))}
                </div>
              ) : (
                <p className="form-hint">
                  Aucun canal disponible pour ce contact.{" "}
                  <Link href="/app/contacts">Modifier le contact</Link>
                </p>
              )}
            </fieldset>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="workspace-form__actions">
            <button
              className="connection-button connection-button--secondary"
              onClick={() => setNewOpen(false)}
              type="button"
            >
              Annuler
            </button>
            <button
              className="connection-button"
              disabled={!contactId || !channel}
              type="submit"
            >
              Commencer la conversation
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function getContactChannels(contact: {
  channel?: ChannelId;
  phone?: string;
  email?: string;
}): ChannelId[] {
  const result = new Set<ChannelId>();
  if (contact.channel) result.add(contact.channel);
  if (contact.phone) result.add("whatsapp");
  if (contact.email) result.add("gmail");
  return [...result];
}

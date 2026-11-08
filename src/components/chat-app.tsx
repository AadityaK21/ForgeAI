"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowDown,
  PanelLeft,
  Search,
  SquarePen,
  Settings,
  LogOut,
  Pencil,
  Trash2,
  Square,
  RotateCcw,
  X,
} from "lucide-react";
import { ChatDialog } from "./chat-dialog";
import { ChatMarkdown, CopyButton } from "./chat-markdown";
import { ChatSettings, type ChatConfig } from "./chat-settings";
import type { ProviderState } from "@/lib/provider-types";
type User = { id: string; email: string };
type Summary = { id: string; title: string; updatedAt: string };
type Message = {
  id: string;
  role: string;
  content: string;
  status: string;
  error?: string | null;
  model?: string | null;
};
type Conversation = Summary & { messages: Message[] };
const blankConfig: ChatConfig = { headers: {}, model: "" };
async function jsonRequest(url: string, options?: RequestInit) {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    ...options,
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(
      data.error || "Unable to complete the request. Please try again.",
    );
  return data;
}
export function ChatApp() {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false);
  const [chats, setChats] = useState<Summary[]>([]),
    [hasMore, setHasMore] = useState(false),
    [search, setSearch] = useState("");
  const [chat, setChat] = useState<Conversation | null>(null),
    [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [sidebar, setSidebar] = useState(true),
    [mobile, setMobile] = useState(false),
    [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false),
    [config, setConfig] = useState<ChatConfig>(blankConfig),
    [status, setStatus] = useState<ProviderState | null>(null);
  const [refresh, setRefresh] = useState(0),
    [historyLoading, setHistoryLoading] = useState(false),
    [historyError, setHistoryError] = useState("");
  const [editing, setEditing] = useState<{
      chat: Summary;
      action: "rename" | "delete";
    } | null>(null),
    [title, setTitle] = useState(""),
    [mutationBusy, setMutationBusy] = useState(false),
    [mutationError, setMutationError] = useState("");
  const [away, setAway] = useState(false),
    [notice, setNotice] = useState("");
  const input = useRef<HTMLTextAreaElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    sidebarRef = useRef<HTMLElement>(null);
  const activeRequest = useRef<AbortController | null>(null),
    running = useRef(false),
    nearBottom = useRef(true),
    selection = useRef(0);
  const pendingNavigation = useRef<string | null>(null);
  const openChat = useCallback(async (id: string, push = true) => {
    if (running.current) return;
    const version = ++selection.current;
    setLoading(true);
    setError("");
    setDraft("");
    setDrawer(false);
    nearBottom.current = true;
    try {
      const data = await jsonRequest(
        "/api/conversations?id=" + encodeURIComponent(id),
      );
      if (version !== selection.current) return;
      setChat(data.conversation);
      if (push) window.history.pushState({}, "", "/?chat=" + id);
    } catch (e) {
      if (version === selection.current)
        setError(e instanceof Error ? e.message : "Could not load this chat.");
    } finally {
      if (version === selection.current) setLoading(false);
    }
  }, []);
  const newChat = useCallback(() => {
    if (running.current) return;
    selection.current++;
    setChat(null);
    setDraft("");
    setError("");
    setLoading(false);
    setDrawer(false);
    setAway(false);
    window.history.pushState({}, "", "/");
    input.current?.focus();
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      if (viewport && innerWidth <= 760 && viewport.scale === 1)
        document.documentElement.style.setProperty(
          "--chat-height",
          `${viewport.height}px`,
        );
      else document.documentElement.style.removeProperty("--chat-height");
    };
    resize();
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
      document.documentElement.style.removeProperty("--chat-height");
    };
  }, []);
  useEffect(() => {
    let live = true;
    const media = matchMedia("(max-width: 760px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    jsonRequest("/api/auth/session")
      .then(async (data) => {
        if (!live) return;
        setUser(data.user);
        if (data.user) {
          jsonRequest("/api/settings")
            .then((s) => {
              if (live) setStatus(s);
            })
            .catch(() => {});
          const id = new URLSearchParams(location.search).get("chat");
          if (id) await openChat(id, false);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setReady(true);
      });
    const pop = () => {
      if (running.current) {
        pendingNavigation.current = location.search;
        activeRequest.current?.abort();
        return;
      }
      const id = new URLSearchParams(location.search).get("chat");
      if (id) void openChat(id, false);
      else {
        selection.current++;
        setChat(null);
        setError("");
      }
    };
    window.addEventListener("popstate", pop);
    return () => {
      live = false;
      media.removeEventListener("change", update);
      window.removeEventListener("popstate", pop);
      activeRequest.current?.abort();
    };
  }, [openChat]);
  useEffect(() => {
    if (!user) return;
    const abort = new AbortController();
    const timer = setTimeout(
      () => {
        setHistoryLoading(true);
        setHistoryError("");
        jsonRequest("/api/conversations?q=" + encodeURIComponent(search), {
          signal: abort.signal,
        })
          .then((data) => {
            setChats(data.conversations);
            setHasMore(data.hasMore);
          })
          .catch((e) => {
            if (!abort.signal.aborted) setHistoryError(e.message);
          })
          .finally(() => {
            if (!abort.signal.aborted) setHistoryLoading(false);
          });
      },
      search ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [user, search, refresh]);
  useEffect(() => {
    const field = input.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = Math.min(field.scrollHeight, 190) + "px";
    }
  }, [draft, chat?.id]);
  useEffect(() => {
    if (nearBottom.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [chat, busy, loading]);
  useEffect(() => {
    if (busy || !chat?.messages.some((m) => m.status === "streaming")) return;
    const abort = new AbortController();
    const timer = setInterval(() => {
      jsonRequest("/api/conversations?id=" + chat.id, { signal: abort.signal })
        .then((data) =>
          setChat((current) =>
            current?.id === chat.id ? data.conversation : current,
          ),
        )
        .catch(() => {});
    }, 2000);
    return () => {
      clearInterval(timer);
      abort.abort();
    };
  }, [busy, chat?.id, chat?.messages]);
  useEffect(() => {
    function shortcuts(e: KeyboardEvent) {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "o"
      ) {
        e.preventDefault();
        newChat();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSidebar(true);
        setDrawer(true);
        setTimeout(() => searchInput.current?.focus(), 0);
      }
    }
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [newChat]);
  useEffect(() => {
    if (!mobile || !drawer) return;
    const prior = document.activeElement as HTMLElement;
    const root = sidebarRef.current!;
    root.querySelector<HTMLButtonElement>("button")?.focus();
    function trap(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawer(false);
      if (e.key === "Tab") {
        const items = Array.from(
          root.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[href], input",
          ),
        );
        if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
          e.preventDefault();
          items[0]?.focus();
        }
      }
    }
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      prior?.focus();
    };
  }, [mobile, drawer]);
  async function send(retryId?: string) {
    if (running.current || loading || (!retryId && !draft.trim())) return;
    if (!user) {
      setError("Sign in or create an account to start chatting.");
      return;
    }
    const message = draft.trim();
    running.current = true;
    setBusy(true);
    setError("");
    nearBottom.current = true;
    setAway(false);
    const abort = new AbortController();
    activeRequest.current = abort;
    let started = false,
      completed = false;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...config.headers },
        body: JSON.stringify({
          conversationId: chat?.id,
          requestId: crypto.randomUUID(),
          ...(retryId ? { retryId } : { message }),
          model: config.model || undefined,
        }),
        signal: abort.signal,
        redirect: "error",
      });
      if (!response.ok) {
        const data = await response.json();
        throw Error(data.error || "Could not send the message.");
      }
      if (!response.body) throw Error("The response stream is unavailable.");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const chunk = await reader.read();
          buffer += decoder.decode(chunk.value, { stream: !chunk.done });
          const lines = buffer.split("\n");
          buffer = chunk.done ? "" : lines.pop()!;
          for (const line of lines)
            if (line.trim()) {
              const event = JSON.parse(line);
              if (event.type === "start") {
                started = true;
                setDraft("");
                setChat({ ...event.conversation, messages: event.messages });
                window.history.replaceState(
                  {},
                  "",
                  "/?chat=" + event.conversation.id,
                );
                setRefresh((v) => v + 1);
              }
              if (event.type === "delta")
                setChat(
                  (c) =>
                    c && {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === event.id
                          ? { ...m, content: m.content + event.text }
                          : m,
                      ),
                    },
                );
              if (event.type === "done") {
                completed = true;
                setChat(
                  (c) =>
                    c && {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === event.id
                          ? { ...m, status: event.status, error: event.error }
                          : m,
                      ),
                    },
                );
              }
              if (event.type === "error") throw Error(event.error);
            }
          if (chunk.done) break;
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      if (!completed)
        throw Error(
          "The connection ended early. Reopen this chat to recover the saved response.",
        );
    } catch (e) {
      const text = abort.signal.aborted
        ? "Response stopped."
        : e instanceof Error
          ? e.message
          : "Unable to send. Please try again.";
      if (started)
        setChat(
          (c) =>
            c && {
              ...c,
              messages: c.messages.map((m) =>
                m.status === "streaming"
                  ? {
                      ...m,
                      status: abort.signal.aborted ? "stopped" : "error",
                      error: text,
                    }
                  : m,
              ),
            },
        );
      else setError(text);
    } finally {
      running.current = false;
      activeRequest.current = null;
      setBusy(false);
      setRefresh((v) => v + 1);
      input.current?.focus();
      if (pendingNavigation.current !== null) {
        const id = new URLSearchParams(pendingNavigation.current).get("chat");
        pendingNavigation.current = null;
        if (id) void openChat(id, false);
        else {
          selection.current++;
          setChat(null);
          setDraft("");
          setError("");
        }
      }
    }
  }
  async function changeConversation() {
    if (!editing || mutationBusy) return;
    setMutationBusy(true);
    setMutationError("");
    try {
      await jsonRequest("/api/conversations", {
        method: editing.action === "delete" ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.chat.id,
          ...(editing.action === "rename" ? { title } : {}),
        }),
      });
      if (chat?.id === editing.chat.id) {
        if (editing.action === "delete") newChat();
        else setChat((c) => c && { ...c, title });
      }
      setNotice(
        editing.action === "delete"
          ? "Conversation deleted."
          : "Conversation renamed.",
      );
      setEditing(null);
      setRefresh((v) => v + 1);
    } catch (e) {
      setMutationError(
        e instanceof Error ? e.message : "Could not update conversation.",
      );
    } finally {
      setMutationBusy(false);
    }
  }
  async function signOut() {
    try {
      await jsonRequest("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setConfig(blankConfig);
      window.location.assign("/sign-in");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign out.");
    }
  }
  const active = Boolean(chat?.messages.length),
    visibleSidebar = mobile ? drawer : sidebar;
  return (
    <div
      className={
        "chat-app" +
        (visibleSidebar ? " sidebar-visible" : "") +
        (drawer ? " drawer-open" : "") +
        (active ? " has-conversation" : "")
      }
    >
      <a className="skip-link" href="#message-input">
        Skip to message
      </a>
      {mobile && drawer && (
        <button
          className="drawer-shade"
          aria-label="Close navigation"
          tabIndex={-1}
          onClick={() => setDrawer(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        className="chat-sidebar"
        aria-label="Conversations"
        {...(mobile && drawer ? { role: "dialog", "aria-modal": true } : {})}
      >
        <div className="sidebar-heading">
          <Link
            href="/"
            className="wordmark"
            onClick={(e) => {
              e.preventDefault();
              newChat();
            }}
          >
            Merova AI
          </Link>
          <button
            className="icon-button"
            aria-label="Collapse sidebar"
            onClick={() => {
              setSidebar(false);
              setDrawer(false);
            }}
          >
            <PanelLeft size={19} />
          </button>
        </div>
        <nav aria-label="Main navigation">
          <button className="nav-button" disabled={busy} onClick={newChat}>
            <SquarePen size={18} />
            New chat
          </button>
          <button
            className="nav-button"
            onClick={() => searchInput.current?.focus()}
          >
            <Search size={18} />
            Search conversations
          </button>
        </nav>
        <div className="history-heading">
          <h2>Chat history</h2>
        </div>
        <label className="history-search">
          <Search size={15} />
          <input
            ref={searchInput}
            aria-label="Search conversations"
            placeholder="Search chats"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="icon-button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
            >
              <X size={14} />
            </button>
          )}
        </label>
        <div className="history-list" aria-busy={historyLoading}>
          {historyError && (
            <p className="error-text">
              {historyError}{" "}
              <button onClick={() => setRefresh((v) => v + 1)}>Retry</button>
            </p>
          )}
          {historyLoading && !chats.length ? (
            <p className="sidebar-hint">Loading conversations…</p>
          ) : (
            !chats.length && (
              <p className="sidebar-hint">
                {!user
                  ? "Sign in to save your conversations."
                  : search
                    ? "No conversations found."
                    : "Your conversations will appear here."}
              </p>
            )
          )}
          {chats.map((c) => (
            <div
              className={"history-row" + (c.id === chat?.id ? " selected" : "")}
              key={c.id}
            >
              <button
                className="history-open"
                disabled={busy}
                title={c.title}
                aria-current={c.id === chat?.id ? "page" : undefined}
                onClick={() => void openChat(c.id)}
              >
                <span>{c.title}</span>
              </button>
              <div className="history-actions">
                <button
                  className="icon-button"
                  aria-label={"Rename " + c.title}
                  disabled={busy}
                  onClick={() => {
                    setEditing({ chat: c, action: "rename" });
                    setTitle(c.title);
                    setMutationError("");
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-button"
                  aria-label={"Delete " + c.title}
                  disabled={busy}
                  onClick={() => {
                    setEditing({ chat: c, action: "delete" });
                    setMutationError("");
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {hasMore && (
            <button
              className="nav-button"
              disabled={historyLoading}
              onClick={async () => {
                setHistoryLoading(true);
                try {
                  const data = await jsonRequest(
                    `/api/conversations?q=${encodeURIComponent(search)}&offset=${chats.length}`,
                  );
                  setChats((v) => [...v, ...data.conversations]);
                  setHasMore(data.hasMore);
                } catch {
                  setHistoryError("Could not load more chats.");
                } finally {
                  setHistoryLoading(false);
                }
              }}
            >
              Load more
            </button>
          )}
        </div>
        <div className="sidebar-bottom">
          <button
            className="nav-button"
            disabled={busy}
            onClick={() => {
              if (user) setSettings(true);
              else window.location.assign("/sign-in");
            }}
          >
            <Settings size={18} />
            Settings & models
          </button>
          {user ? (
            <>
              <div className="profile-row">
                <span className="avatar" aria-hidden="true">
                  {user.email.slice(0, 1).toUpperCase()}
                </span>
                <span className="profile-email" title={user.email}>
                  {user.email}
                </span>
              </div>
              <button
                className="nav-button"
                disabled={busy}
                onClick={() => void signOut()}
              >
                <LogOut size={17} />
                Sign out
              </button>
            </>
          ) : (
            <div className="auth-links">
              <Link href="/sign-in">Sign in</Link>
              <Link className="primary-button" href="/sign-up">
                Create account
              </Link>
            </div>
          )}
        </div>
      </aside>
      <main className="chat-main" inert={mobile && drawer ? true : undefined}>
        <header className="chat-header">
          <div>
            {(!sidebar || mobile) && (
              <button
                className="icon-button"
                aria-label="Open sidebar"
                onClick={() => {
                  setSidebar(true);
                  setDrawer(true);
                }}
              >
                <PanelLeft size={21} />
              </button>
            )}
            <span>{active ? chat?.title : "Merova AI"}</span>
          </div>
          {user ? (
            <button
              className="icon-button"
              aria-label="Model settings"
              disabled={busy}
              onClick={() => setSettings(true)}
            >
              <Settings size={19} />
            </button>
          ) : (
            <Link className="header-signin" href="/sign-in">
              Sign in
            </Link>
          )}
        </header>
        <div
          ref={scroll}
          className="chat-scroll"
          onScroll={() => {
            const el = scroll.current!;
            nearBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 100;
            setAway(!nearBottom.current);
          }}
        >
          {loading ? (
            <div className="chat-loading" role="status">
              <span />
              <span />
              <span />
              Loading conversation…
            </div>
          ) : active ? (
            <div className="message-column">
              {chat!.messages.map((m, i) => (
                <article
                  className={
                    "message " +
                    (m.role === "user" ? "user-message" : "assistant-message")
                  }
                  key={m.id}
                  aria-label={m.role === "user" ? "You" : "Merova AI"}
                >
                  {m.role === "user" ? (
                    <div className="user-bubble" dir="auto">
                      {m.content}
                    </div>
                  ) : (
                    <>
                      <ChatMarkdown text={m.content} />
                      {m.status === "streaming" && !m.content && (
                        <span className="thinking" role="status">
                          Thinking<span>…</span>
                        </span>
                      )}
                      {m.error && (
                        <p className="message-error" role="status">
                          {m.error}
                        </p>
                      )}
                      <div className="message-actions">
                        {m.content && <CopyButton text={m.content} />}
                        {m.status !== "streaming" &&
                          m.status !== "complete" &&
                          i === chat!.messages.length - 1 && (
                            <button
                              disabled={busy}
                              onClick={() => void send(m.id)}
                            >
                              <RotateCcw size={14} />
                              Retry response
                            </button>
                          )}
                      </div>
                    </>
                  )}
                </article>
              ))}
              <span className="sr-only" role="status">
                {busy ? "Merova AI is responding." : ""}
              </span>
            </div>
          ) : null}
          {!active && !loading && (
            <div className="empty-chat">
              <h1>What&apos;s on your mind today?</h1>
              {composer()}
            </div>
          )}
        </div>
        {active && (
          <div className="composer-dock">
            {away && (
              <button
                className="scroll-bottom icon-button"
                aria-label="Scroll to latest message"
                onClick={() => {
                  scroll.current?.scrollTo({
                    top: scroll.current.scrollHeight,
                    behavior: "smooth",
                  });
                  nearBottom.current = true;
                }}
              >
                <ArrowDown size={18} />
              </button>
            )}
            {composer()}
            <p className="chat-footnote">
              Merova AI can make mistakes. Check important information.
            </p>
          </div>
        )}
        <span className="sr-only" role="status">
          {notice}
        </span>
      </main>
      {settings && (
        <ChatSettings
          current={config}
          status={status}
          close={() => setSettings(false)}
          save={(c, s) => {
            setConfig(c);
            setStatus(s);
            setNotice("Model settings updated.");
          }}
        />
      )}
      {editing && (
        <ChatDialog
          title={
            editing.action === "rename"
              ? "Rename conversation"
              : "Delete conversation?"
          }
          close={() => {
            if (!mutationBusy) setEditing(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void changeConversation();
            }}
          >
            {editing.action === "rename" ? (
              <label>
                Title
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={100}
                  required
                  disabled={mutationBusy}
                />
              </label>
            ) : (
              <p>
                This permanently deletes “{editing.chat.title}” and its
                messages.
              </p>
            )}
            {mutationError && (
              <p role="alert" className="error-text">
                {mutationError}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                disabled={mutationBusy}
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button
                className={
                  editing.action === "delete"
                    ? "danger-button"
                    : "primary-button"
                }
                disabled={
                  mutationBusy || (editing.action === "rename" && !title.trim())
                }
              >
                {mutationBusy
                  ? "Saving…"
                  : editing.action === "rename"
                    ? "Save"
                    : "Delete"}
              </button>
            </div>
          </form>
        </ChatDialog>
      )}
    </div>
  );
  function composer() {
    return (
      <div className="composer-wrap">
        {error && (
          <div className="composer-error" role="alert">
            {error}
            {!user && <Link href="/sign-in">Sign in</Link>}
            {user && /provider|API key|Settings/.test(error) && (
              <button onClick={() => setSettings(true)}>Open settings</button>
            )}
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={input}
            id="message-input"
            aria-label="Message Merova AI"
            dir="auto"
            placeholder="Message Merova AI"
            rows={1}
            maxLength={16000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                if (!busy) void send();
              }
            }}
          />
          <div className="composer-controls">
            {busy ? (
              <button
                type="button"
                className="send-button"
                aria-label="Stop response"
                onClick={() => activeRequest.current?.abort()}
              >
                <Square size={16} fill="currentColor" />
              </button>
            ) : (
              <button
                className="send-button"
                aria-label="Send message"
                disabled={!ready || !draft.trim() || loading}
              >
                <ArrowUp size={20} />
              </button>
            )}
          </div>
        </form>
      </div>
    );
  }
}

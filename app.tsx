// bb-plugin-side-chat-unread — frontend entry.
//
// Side chats are hidden fork threads that the bundled side-chat plugin opens
// as "Side chat" tabs in a thread's right panel. This plugin draws a blue dot
// on a Side chat tab while its side chat is idle and unread.
//
// The tab strip is host DOM with no thread ids on it, so the dot is matched by
// order: the n-th tab with the SideChat icon in a strip is the n-th side-chat
// tab in that thread's persisted tab list. The plugin marks a side chat read
// when its tab is selected in a focused window. Reads publish no event, so
// state is polled while a strip is on screen.
import { useEffect, useRef } from "react";
import {
  definePluginApp,
  useBbContext,
  useRealtime,
  useSdk,
  useSidebarSplitLayout,
  type PluginSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";

const SIDE_CHAT_PLUGIN_ID = "side-chat";
// Keep in sync with SIDE_CHAT_CHANGED in server.ts.
const SIDE_CHAT_CHANGED = "side-chat-changed";
const BUSY_STATUSES = new Set(["starting", "active", "stopping"]);
const POLL_MS = 3000;

const STRIP_SELECTOR = "[data-testid=secondary-panel-tab-strip]";
const PANE_ATTRIBUTE = "data-sidebar-split-tab-group";
const SIDE_CHAT_TAB_SELECTOR = "button[aria-pressed]:has([data-icon=SideChat])";
const DOT_ATTRIBUTE = "data-side-chat-unread-dot";

type SideChatRow = {
  id: string;
  status: string;
  archivedAt: number | null;
  lastReadAt: number | null;
  latestAttentionAt: number;
};

type PanelTab = { pluginId?: string; actionId?: string; paramsJson?: string };

/** Per source thread: side chat ids in tab order, and which are unread. */
type ThreadState = { tabSideChatIds: (string | null)[]; unread: Set<string> };

function isFinishedUnread(thread: SideChatRow): boolean {
  return (
    thread.archivedAt === null &&
    !BUSY_STATUSES.has(thread.status) &&
    (thread.lastReadAt === null || thread.latestAttentionAt > thread.lastReadAt)
  );
}

function sideChatIdOf(tab: PanelTab): string | null {
  try {
    const params: unknown = JSON.parse(tab.paramsJson ?? "null");
    if (typeof params !== "object" || params === null) return null;
    const threadId = (params as { threadId?: unknown }).threadId;
    return typeof threadId === "string" ? threadId : null;
  } catch {
    return null;
  }
}

function stripThreadId(
  strip: Element,
  layout: PluginSidebarSplitLayout | null,
  routeThreadId: string | null,
): string | null {
  const paneId = strip.closest(`[${PANE_ATTRIBUTE}]`)?.getAttribute(PANE_ATTRIBUTE);
  const pane = layout?.panes.find((candidate) => candidate.paneId === paneId);
  return pane?.threadId ?? routeThreadId;
}

function createDot(): HTMLSpanElement {
  const dot = document.createElement("span");
  dot.setAttribute(DOT_ATTRIBUTE, "");
  dot.setAttribute("role", "status");
  dot.setAttribute("aria-label", "Unread");
  dot.title = "Side chat finished";
  Object.assign(dot.style, {
    display: "inline-block",
    flexShrink: "0",
    width: "7px",
    height: "7px",
    marginLeft: "6px",
    borderRadius: "9999px",
    backgroundColor: "#3b82f6",
  });
  return dot;
}

function SideChatTabDots() {
  const sdk = useSdk();
  const { threadId: routeThreadId } = useBbContext();
  const layout = useSidebarSplitLayout();
  const states = useRef(new Map<string, ThreadState>());
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;

    const visibleStrips = () =>
      Array.from(document.querySelectorAll(STRIP_SELECTOR))
        .map((strip) => ({
          strip,
          threadId: stripThreadId(strip, layout, routeThreadId),
          tabs: Array.from(strip.querySelectorAll(SIDE_CHAT_TAB_SELECTOR)),
        }))
        .filter((entry) => entry.tabs.length > 0);

    // The user sees a side chat when its tab is selected in a focused window.
    const markSeen = (state: ThreadState, sideChatId: string) => {
      state.unread.delete(sideChatId);
      void sdk.threads.markRead({ threadId: sideChatId }).catch(() => {});
    };

    const decorate = () => {
      const focused = document.visibilityState === "visible" && document.hasFocus();
      for (const { threadId, tabs } of visibleStrips()) {
        const state = threadId === null ? undefined : states.current.get(threadId);
        tabs.forEach((tab, index) => {
          const sideChatId = state?.tabSideChatIds[index] ?? null;
          let unread = sideChatId !== null && state!.unread.has(sideChatId);
          if (unread && focused && tab.getAttribute("aria-pressed") === "true") {
            markSeen(state!, sideChatId!);
            unread = false;
          }
          const dot = tab.querySelector(`[${DOT_ATTRIBUTE}]`);
          if (unread && dot === null) tab.appendChild(createDot());
          if (!unread && dot !== null) dot.remove();
        });
      }
    };

    const load = async (threadId: string): Promise<ThreadState> => {
      const [tabsResult, sideChats] = await Promise.all([
        sdk.threads.tabs.get({ threadId }),
        sdk.threads.list({
          sourceThreadId: threadId,
          originPluginId: SIDE_CHAT_PLUGIN_ID,
          includeHidden: true,
        }) as Promise<SideChatRow[]>,
      ]);
      const tabSideChatIds = (tabsResult.tabs as PanelTab[])
        .filter(
          (tab) =>
            tab.pluginId === SIDE_CHAT_PLUGIN_ID &&
            tab.actionId === SIDE_CHAT_PLUGIN_ID,
        )
        .map(sideChatIdOf);
      const unread = new Set(
        sideChats.filter(isFinishedUnread).map((thread) => thread.id),
      );
      return { tabSideChatIds, unread };
    };

    const refresh = async () => {
      const threadIds = new Set(
        visibleStrips()
          .map((entry) => entry.threadId)
          .filter((id): id is string => id !== null),
      );
      const results = await Promise.allSettled(
        [...threadIds].map(async (id) => [id, await load(id)] as const),
      );
      if (disposed) return;
      for (const result of results) {
        if (result.status === "fulfilled") states.current.set(...result.value);
      }
      decorate();
    };
    refreshRef.current = () => void refresh();

    // Tabs mount, remount, and reorder at any time; reapply on DOM changes.
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        decorate();
      });
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-pressed"],
    });
    window.addEventListener("focus", decorate);

    void refresh();
    const timer = setInterval(() => {
      if (visibleStrips().length > 0) void refresh();
    }, POLL_MS);

    return () => {
      disposed = true;
      clearInterval(timer);
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("focus", decorate);
      document.querySelectorAll(`[${DOT_ATTRIBUTE}]`).forEach((dot) => dot.remove());
    };
  }, [sdk, layout, routeThreadId]);

  useRealtime(SIDE_CHAT_CHANGED, () => refreshRef.current());

  return null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "side-chat-tab-dots",
    component: SideChatTabDots,
  });
});

// bb-plugin-side-chat-unread — backend entry.
//
// Side chats are hidden fork threads, so the app's sidebar data does not carry
// them. This entry tells open headers to refetch when a side chat changes
// lifecycle state. app.tsx owns the rest.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

const SIDE_CHAT_PLUGIN_ID = "side-chat";
export const SIDE_CHAT_CHANGED = "side-chat-changed";

type ThreadLifecycleEvent = {
  thread: { originPluginId: string | null; sourceThreadId: string | null };
};

export default function plugin(bb: BbPluginApi) {
  const publish = ({ thread }: ThreadLifecycleEvent) => {
    if (thread.originPluginId !== SIDE_CHAT_PLUGIN_ID) return;
    if (thread.sourceThreadId === null) return;
    bb.realtime.publish(SIDE_CHAT_CHANGED, {
      sourceThreadId: thread.sourceThreadId,
    });
  };

  bb.events.on("thread.active", publish);
  bb.events.on("thread.idle", publish);
  bb.events.on("thread.failed", publish);
  bb.events.on("thread.archived", publish);
  bb.events.on("thread.unarchived", publish);
  bb.events.on("thread.deleted", publish);
}

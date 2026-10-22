# bb-plugin-side-chat-unread

This plugin shows a blue dot on a Side chat tab when that side chat finished its turn and you did not read it yet.

A side chat is a hidden fork thread that the bundled Side chat plugin opens as a tab in the right panel of a thread.

## Behavior

- The dot appears on a Side chat tab when its side chat is idle and unread.
- If you select the tab while the bb window has focus, the plugin marks the side chat as read and removes the dot.
- The dot shows only while the right panel is open, because the tab is not on screen otherwise.

## How it works

The tab strip has no thread ids in its markup. The plugin matches the n-th Side chat tab in a strip to the n-th side chat tab in the saved tab list of that thread. It reads the state again every 3 seconds while a Side chat tab is on screen, and immediately when a side chat starts or stops.

## Install

Run this command to install the latest release:

```
bb plugin install git:https://github.com/infovlad/bb-plugin-side-chat-unread.git@^0.1.0
```

To work on the plugin from a local clone, run these commands in the clone:

```
npm install --include=dev
bb plugin install .
```

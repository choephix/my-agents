import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { SavedThread } from "./read";

/**
 * Which thread's 🌙 modal is open, and who draws it. The modal can't live where it is opened: a
 * hub row may be redrawn as a new component (opening marks the thread read), and on web a modal of
 * the plugin's own inside an Unread/Search popover hangs the page (the popover's overlay and the
 * modal fight over focus). So the popover closes first and a host draws the modal: the sidebar
 * strip (mounted wherever the sidebar is) or the thread's own hub row; the earliest mounted wins.
 */
let reading: string | null = null;
const hosts: symbol[] = [];
const listeners = new Set<() => void>();
const changed = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export const readThread = (id: string | null) => {
  reading = id;
  changed();
};
/** Some host is mounted to draw the modal. */
export const canHost = () => hosts.length > 0;
export const useReading = () => useSyncExternalStore(subscribe, () => reading);

export function ReadingHost({ theme, compact, wake }: { theme: PluginTheme; compact: boolean; wake(id: string): Promise<void> }) {
  const token = useRef(Symbol("host")).current;
  useEffect(() => {
    hosts.push(token);
    changed();
    return () => {
      hosts.splice(hosts.indexOf(token), 1);
      changed();
    };
  }, [token]);
  const id = useReading();
  const first = useSyncExternalStore(subscribe, () => hosts[0] === token);
  return id && first ? <SavedThread key={id} threadId={id} theme={theme} compact={compact} wake={wake} onClose={() => readThread(null)} /> : null;
}

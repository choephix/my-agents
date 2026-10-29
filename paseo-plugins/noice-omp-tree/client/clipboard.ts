import { copyText } from "@getpaseo/plugin/client/react-native";
import { Platform } from "react-native";

/**
 * Paseo's copyText; on web it falls back to the old execCommand("copy") path, which still works
 * where the async clipboard API is denied (e.g. a browser without clipboard permission). The copy
 * event carries the text, so no element has to take focus (a sheet's focus trap would refuse it).
 * Call it from inside the click: browsers allow clipboard writes only during a user gesture.
 */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await copyText(text);
  } catch (error) {
    if (Platform.OS !== "web") throw error;
    const onCopy = (event: ClipboardEvent) => {
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
    };
    document.addEventListener("copy", onCopy, true);
    try {
      if (!document.execCommand("copy")) throw error;
    } finally {
      document.removeEventListener("copy", onCopy, true);
    }
  }
}

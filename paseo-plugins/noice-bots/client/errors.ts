/** The handler's own sentence, without Paseo's "Request failed:" prefix and `requestType=… code=…` tail. */
export const humanError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/^Request failed:\s*/, "").replace(/\s+requestType=\S+(\s+code=\S+)?\s*$/, "");

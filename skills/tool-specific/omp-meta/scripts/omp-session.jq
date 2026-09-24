# Shared record-to-text helpers for omp-transcript search and @omp-find.
# Callers must define $reasoning and $with_tools.

def re_escape:
  [46, 94, 36, 124, 63, 42, 43, 40, 41, 91, 93, 123, 125, 92] as $meta
  | explode
  | map(. as $codepoint
        | if ($meta | index($codepoint)) != null then [92, $codepoint] else [$codepoint] end)
  | (add // [])
  | implode;

def text_content:
  .message.content as $content
  | if ($content | type) == "string" then $content
    elif ($content | type) == "array" then
      [$content[] | select(.type == "text") | (.text // "")] | join("\n")
    else ""
    end;

# Everything a human said, or that summarises what was said. Reasoning and
# tool traffic join only when explicitly asked for.
def visible:
  . as $record
  | if $record.type == "message" then
      ($record.message.role // "") as $role
      | if $role == "user" or $role == "developer" then
          [{ role: $role, text: ($record | text_content) }]
        elif $role == "assistant" then
          [ $record.message.content[]?
            | if .type == "text" and (.text | type) == "string" then
                { role: "assistant", text: .text }
              elif $reasoning and .type == "thinking" and (.thinking | type) == "string" then
                { role: "reasoning", text: .thinking }
              elif $with_tools and .type == "toolCall" then
                { role: "tool-call", text: "\(.name // "") \((.arguments // .input // {}) | tojson)" }
              else empty
              end ]
        elif $role == "bashExecution" then
          [{ role: "bash", text: ($record.message.command // "") }]
        elif $role == "fileMention" then
          [ $record.message.files[]?
            | { role: "file-mention",
                text: ((.path // "")
                       + (if $with_tools and (.content | type) == "string"
                          then "\n" + .content
                          else ""
                          end)) } ]
        elif $role == "toolResult" and $with_tools then
          [{ role: "tool-result", text: ($record | text_content) }]
        else []
        end
    elif $record.type == "custom_message" then
      if (["branch-summary", "rewind-report", "compaction-summary", "prose-note", "irc:incoming"]
          | index($record.customType // "")) != null
         and ($record.content | type) == "string" then
        [{ role: "custom:\($record.customType)", text: $record.content }]
      else []
      end
    elif $record.type == "compaction" and ($record.summary | type) == "string" then
      [{ role: "compaction", text: $record.summary }]
    elif $record.type == "branch_summary" and ($record.summary | type) == "string" then
      [{ role: "branch-summary", text: $record.summary }]
    elif (["session", "title", "title_change"] | index($record.type // "")) != null
         and ($record.title | type) == "string" and $record.title != "" then
      [{ role: "title", text: $record.title }]
    else []
    end;

def rank($role):
  if $role == "user" then 0
  elif $role == "developer" then 1
  elif $role == "title" then 2
  elif $role == "assistant" then 3
  else 4
  end;

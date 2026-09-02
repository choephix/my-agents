#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "$0")" && pwd)
export PATH="$repo:$PATH"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# 1. Render only the active branch. Tool traffic is hidden by default,
# --with-tools indexes it, and --hydrate inlines result bodies.
session="$tmp/session.jsonl"
cat >"$session" <<'EOF'
{"type":"message","id":"u1","parentId":null,"message":{"role":"user","content":[{"type":"text","text":"Start\n## Objective\nKeep it clear.\nLiteral </user> marker."}]}}
{"type":"message","id":"old-a","parentId":"u1","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Abandoned reasoning"}]}}
{"type":"message","id":"old-result","parentId":"old-a","message":{"role":"toolResult","toolName":"bash","isError":false,"content":[{"type":"text","text":"abandoned result"}]}}
{"type":"message","id":"active-a","parentId":"u1","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Active reasoning"},{"type":"toolCall","name":"read","arguments":{"path":"file.txt"}}]}}
{"type":"message","id":"active-result","parentId":"active-a","message":{"role":"toolResult","toolName":"read","isError":false,"content":[{"type":"text","text":"exact active result"}]}}
{"type":"custom_message","id":"skill","parentId":"active-result","customType":"skill-prompt","content":"Use this skill prompt."}
{"type":"message","id":"active-answer","parentId":"skill","message":{"role":"assistant","content":[{"type":"text","text":"Active answer"}]}}
EOF

rendered=$(omp-transcript "$session")
[[ $rendered == *$'<user>\nStart\n## Objective\nKeep it clear.\nLiteral </user> marker.\n</user>'* ]]
[[ $rendered != *"<reasoning>"* ]]
[[ $rendered == *$'<assistant>\nActive answer\n</assistant>'* ]]
[[ $rendered != *"<tool-call "* ]]
[[ $rendered != *"<tool-result "* ]]
[[ $rendered != *"Abandoned reasoning"* ]]
[[ $rendered != *"abandoned result"* ]]

# Reasoning is opt-in, and pairs with its own record's text without splitting the message.
reasoned=$(omp-transcript "$session" --reasoning)
[[ $reasoned == *$'<reasoning>\nActive reasoning\n</reasoning>'* ]]
[[ $reasoned == *$'<assistant>\nActive answer\n</assistant>'* ]]
[[ $reasoned != *"Abandoned reasoning"* ]]

hydrated=$(omp-transcript result --session "$session" --message-id active-result)
[[ $hydrated == "exact active result" ]]

if omp-transcript result --session "$session" --message-id old-result >/dev/null 2>&1; then
  echo "inactive result unexpectedly succeeded" >&2
  exit 1
fi

rendered_with_tools=$(omp-transcript "$session" --with-tools)
[[ $rendered_with_tools == *'<tool-call name="read">'* ]]
[[ $rendered_with_tools == *'<tool-result tool="read" status="successful" bytes="19">'* ]]
[[ $rendered_with_tools == *"--message-id 'active-result'"* ]]
[[ $rendered_with_tools == *$'```bash\nomp-transcript result '* ]]
[[ $rendered_with_tools != *"exact active result"* ]]
[[ $rendered_with_tools != *"Omitted:"* ]]

rendered_hydrated=$(omp-transcript --hydrate "$session")
[[ $rendered_hydrated == *'<tool-call name="read">'* ]]
[[ $rendered_hydrated == *'<tool-result tool="read" status="successful" bytes="19">'* ]]
[[ $rendered_hydrated == *$'<tool-result tool="read" status="successful" bytes="19">\n```\nexact active result\n```\n</tool-result>'* ]]
combined_flags=$(omp-transcript "$session" --with-tools --hydrate)
[[ $combined_flags == "$rendered_hydrated" ]]

# 2. Non-empty skill-prompt custom messages render in every render tier.
custom_section=$'<custom-message type="skill-prompt">\nUse this skill prompt.\n</custom-message>'
[[ $rendered != *'<custom-message type="Skill prompt">'* ]]
[[ $rendered == *"$custom_section"* ]]
[[ $rendered_with_tools == *"$custom_section"* ]]
[[ $rendered_hydrated == *"$custom_section"* ]]

# 3. Harness shell executions and file mentions are user input in every tier.
input_session="$tmp/input-roles.jsonl"
cat >"$input_session" <<'EOF'
{"type":"message","id":"bash-ok","parentId":null,"message":{"role":"bashExecution","command":"printf ok","output":"shell output","exitCode":7}}
{"type":"message","id":"bash-cancelled","parentId":"bash-ok","message":{"role":"bashExecution","command":"sleep 1","output":"","cancelled":true}}
{"type":"message","id":"bash-truncated","parentId":"bash-cancelled","message":{"role":"bashExecution","command":"long command","output":"partial output","exitCode":130,"truncated":true}}
{"type":"message","id":"files","parentId":"bash-truncated","message":{"role":"fileMention","files":[{"path":"alpha.txt","lineCount":2,"content":"alpha\nbeta"},{"path":"notes.txt","lineCount":1,"content":"xyz"}]}}
{"type":"message","id":"image","parentId":"files","message":{"role":"fileMention","files":[{"path":"diagram.png","content":"","image":{"mimeType":"image/png","data":"BASE64-MUST-NOT-RENDER"}}]}}
{"type":"message","id":"input-end","parentId":"image","message":{"role":"assistant","content":[{"type":"text","text":"INPUT ROLE END"}]}}
EOF

input_rendered=$(omp-transcript "$input_session")
[[ $input_rendered == *$'<bash-execution command="printf ok" exit="7">\n```\nshell output\n```\n</bash-execution>'* ]]
[[ $input_rendered == *$'<bash-execution command="sleep 1" cancelled="true">\n```\n\n```\n</bash-execution>'* ]]
[[ $input_rendered != *'<bash-execution command="sleep 1" exit='* ]]
[[ $input_rendered == *$'<bash-execution command="long command" exit="130" truncated="true">\n```\npartial output\n```\n</bash-execution>'* ]]
[[ $input_rendered == *'<file-mention path="alpha.txt" lines="2" bytes="10" />'* ]]
[[ $input_rendered == *'<file-mention path="notes.txt" lines="1" bytes="3" />'* ]]
[[ $input_rendered != *$'alpha\nbeta'* && $input_rendered != *$'\nxyz\n'* ]]
[[ $input_rendered == *'<file-mention path="diagram.png" image="image/png" />'* ]]
[[ $input_rendered != *'BASE64-MUST-NOT-RENDER'* ]]

input_with_tools=$(omp-transcript "$input_session" --with-tools)
[[ $input_with_tools == *$'<file-mention path="alpha.txt" lines="2" bytes="10">\n```\nalpha\nbeta\n```\n</file-mention>'* ]]
[[ $input_with_tools == *$'<file-mention path="notes.txt" lines="1" bytes="3">\n```\nxyz\n```\n</file-mention>'* ]]
[[ $input_with_tools == *'<file-mention path="diagram.png" image="image/png" />'* ]]
[[ $input_with_tools != *'<file-mention path="diagram.png" image="image/png">'* ]]
[[ $input_with_tools != *'BASE64-MUST-NOT-RENDER'* ]]

input_slice=$(omp-transcript "$input_session" -m 4)
[[ $input_slice == *$'- **Messages:** first 4 of 6\n'* ]]
[[ $input_slice == *'<file-mention path="alpha.txt" lines="2" bytes="10" />'* ]]
[[ $input_slice == *'<file-mention path="notes.txt" lines="1" bytes="3" />'* ]]
[[ $input_slice != *'diagram.png'* && $input_slice != *'INPUT ROLE END'* ]]

# 4. A truncated result recovers from details.displayContent.text.
display_session="$tmp/display.jsonl"
cat >"$display_session" <<'EOF'
{"type":"message","id":"display-user","parentId":null,"message":{"role":"user","content":[{"type":"text","text":"Read it"}]}}
{"type":"message","id":"display-call","parentId":"display-user","message":{"role":"assistant","content":[{"type":"toolCall","name":"read","arguments":{"path":"large.txt"}}]}}
{"type":"message","id":"display-result","parentId":"display-call","message":{"role":"toolResult","toolName":"read","isError":false,"content":[{"type":"text","text":"[Output truncated - 42 tokens]"}],"details":{"displayContent":{"text":"complete display content"}}}}
EOF

display_recovered=$(omp-transcript result --session "$display_session" --message-id display-result)
[[ $display_recovered == "complete display content" ]]

# 5. A shaken placeholder hydrates the referenced region from its sidecar.
shake_session="$tmp/shake.jsonl"
cat >"$shake_session" <<'EOF'
{"type":"message","id":"shake-user","parentId":null,"message":{"role":"user","content":[{"type":"text","text":"Run it"}]}}
{"type":"message","id":"shake-call","parentId":"shake-user","message":{"role":"assistant","content":[{"type":"toolCall","name":"bash","arguments":{"command":"example"}}]}}
{"type":"message","id":"shake-result","parentId":"shake-call","message":{"role":"toolResult","toolName":"bash","isError":false,"content":[{"type":"text","text":"[shaken ~8 tokens — recover: artifact://7 (region 2)]"}]}}
EOF
shake_dir="${shake_session%.jsonl}"
mkdir -p "$shake_dir"
cat >"$shake_dir/7.shake.log" <<'EOF'
### region 1 (bash, ~5 tok)

wrong region body

### region 2 (read, ~8 tok)

region two line one
region two line two

EOF

shake_recovered=$(omp-transcript result --session "$shake_session" --message-id shake-result)
[[ $shake_recovered == $'region two line one\nregion two line two' ]]

# 6. A raw-output marker hydrates from the matching bash sidecar.
raw_session="$tmp/raw.jsonl"
cat >"$raw_session" <<'EOF'
{"type":"message","id":"raw-user","parentId":null,"message":{"role":"user","content":[{"type":"text","text":"Run it"}]}}
{"type":"message","id":"raw-call","parentId":"raw-user","message":{"role":"assistant","content":[{"type":"toolCall","name":"bash","arguments":{"command":"example"}}]}}
{"type":"message","id":"raw-result","parentId":"raw-call","message":{"role":"toolResult","toolName":"bash","isError":false,"content":[{"type":"text","text":"first\n[raw output: artifact://1]\nsecond\n[raw output: artifact://2]"}]}}
{"type":"message","id":"mid-call","parentId":"raw-result","message":{"role":"assistant","content":[{"type":"toolCall","name":"bash","arguments":{"command":"another example"}}]}}
{"type":"message","id":"mid-result","parentId":"mid-call","message":{"role":"toolResult","toolName":"bash","isError":false,"content":[{"type":"text","text":"first\n[raw output: artifact://1]\n\nWall time: 0.40 seconds"}]}}
EOF
raw_dir="${raw_session%.jsonl}"
mkdir -p "$raw_dir"
printf '%s' 'complete mid-body bash output' >"$raw_dir/1.bash-original.log"
printf '%s' 'complete original bash output' >"$raw_dir/2.bash-original.log"

raw_recovered=$(omp-transcript result --session "$raw_session" --message-id raw-result)
[[ $raw_recovered == "complete original bash output" ]]
mid_marker_result=$(omp-transcript result --session "$raw_session" --message-id mid-result)
[[ $mid_marker_result == "complete mid-body bash output" ]]

# 7. An unrecoverable placeholder is returned with exit 3, and render mode
# identifies that the full output was not recorded.
missing_session="$tmp/missing.jsonl"
missing_placeholder='[Output truncated - 13 tokens]'
cat >"$missing_session" <<'EOF'
{"type":"message","id":"missing-user","parentId":null,"message":{"role":"user","content":[{"type":"text","text":"Run it"}]}}
{"type":"message","id":"missing-call","parentId":"missing-user","message":{"role":"assistant","content":[{"type":"toolCall","name":"bash","arguments":{"command":"example"}}]}}
{"type":"message","id":"missing-result","parentId":"missing-call","message":{"role":"toolResult","toolName":"bash","isError":false,"content":[{"type":"text","text":"[Output truncated - 13 tokens]"}]}}
EOF

set +e
omp-transcript result --session "$missing_session" --message-id missing-result \
  >"$tmp/missing.stdout" 2>"$tmp/missing.stderr"
missing_status=$?
set -e
[[ $missing_status -eq 3 ]]
[[ $(<"$tmp/missing.stdout") == "$missing_placeholder" ]]
[[ $(<"$tmp/missing.stderr") == "omp-transcript: full output not recorded in session" ]]

missing_rendered=$(omp-transcript "$missing_session" --hydrate)
[[ $missing_rendered == *'<tool-result tool="bash" status="successful" recovered="false">'* ]]
[[ $missing_rendered != *'<tool-result tool="bash" status="successful" bytes='* ]]
[[ $missing_rendered != *"Full output not recorded in session. Placeholder:"* ]]
[[ $missing_rendered == *"$missing_placeholder"* ]]

# 8. A body containing three backticks is enclosed by a longer fence.
fence_session="$tmp/fence.jsonl"
cat >"$fence_session" <<'EOF'
{"type":"message","id":"fence-user","parentId":null,"message":{"role":"user","content":[{"type":"text","text":"Run it"}]}}
{"type":"message","id":"fence-call","parentId":"fence-user","message":{"role":"assistant","content":[{"type":"toolCall","name":"bash","arguments":{"command":"example"}}]}}
{"type":"message","id":"fence-result","parentId":"fence-call","message":{"role":"toolResult","toolName":"bash","isError":false,"content":[{"type":"text","text":"before\n```\nafter"}]}}
EOF

fence_rendered=$(omp-transcript "$fence_session" --hydrate)
[[ $fence_rendered == *$'<tool-result tool="bash" status="successful" bytes="16">\n````\nbefore\n```\nafter\n````\n</tool-result>'* ]]
[[ $fence_rendered == *'<tool-call name="bash">'* ]]

# 9. List mode sorts globally by mtime, limits rows, filters by resolved cwd,
# and emits the exact five-column TSV shape.
sessions_root="$tmp/sessions root"
project_a="$sessions_root/project a"
project_b="$sessions_root/project b"
cwd_a="$tmp/work-a"
cwd_b="$tmp/work-b"
mkdir -p "$project_a" "$project_b" "$cwd_a" "$cwd_b"
cwd_a=$(realpath "$cwd_a")
cwd_b=$(realpath "$cwd_b")
session_a_old="$project_a/a-old.jsonl"
session_a_new="$project_a/a-new.jsonl"
session_b_new="$project_b/b-new.jsonl"
session_b_new_format="$project_b/b-new-format.jsonl"

jq -cn \
  --arg id session-a-old --arg cwd "$cwd_a" --arg title "Alpha old" \
  --arg timestamp 2024-01-01T00:00:01Z \
  '{type:"session", id:$id, cwd:$cwd, title:$title, timestamp:$timestamp}' \
  >"$session_a_old"
jq -cn \
  --arg id session-a-new --arg cwd "$cwd_a" --arg title "Alpha new" \
  --arg timestamp 2024-01-02T00:00:02Z \
  '{type:"session", id:$id, cwd:$cwd, title:$title, timestamp:$timestamp}' \
  >"$session_a_new"
jq -cn \
  --arg id session-b-new --arg cwd "$cwd_b" --arg title "Beta new" \
  --arg timestamp 2024-01-03T00:00:03Z \
  '{type:"session", id:$id, cwd:$cwd, title:$title, timestamp:$timestamp}' \
  >"$session_b_new"
jq -cn \
  --arg title "Beta title record" \
  '{type:"title", title:$title}' \
  >"$session_b_new_format"
jq -cn \
  --arg id session-b-new-format --arg cwd "$cwd_b" \
  --arg timestamp 2023-12-31T00:00:00Z \
  '{type:"session", id:$id, cwd:$cwd, timestamp:$timestamp}' \
  >>"$session_b_new_format"

touch -d 2024-01-01T00:00:01Z "$session_a_old"
touch -d 2024-01-02T00:00:02Z "$session_a_new"
touch -d 2024-01-03T00:00:03Z "$session_b_new"
touch -d 2023-12-31T00:00:00Z "$session_b_new_format"

list_output=$(OMP_SESSIONS_DIR="$sessions_root" omp-transcript list -n 2)
printf -v expected_list '%s\t%s\t%s\t%s\t%s\n%s\t%s\t%s\t%s\t%s' \
  2024-01-03T00:00:03Z session-b-new "Beta new" "$cwd_b" "$session_b_new" \
  2024-01-02T00:00:02Z session-a-new "Alpha new" "$cwd_a" "$session_a_new"
[[ $list_output == "$expected_list" ]]

filtered_output=$(OMP_SESSIONS_DIR="$sessions_root" omp-transcript list --cwd "$cwd_a")
printf -v expected_filtered '%s\t%s\t%s\t%s\t%s\n%s\t%s\t%s\t%s\t%s' \
  2024-01-02T00:00:02Z session-a-new "Alpha new" "$cwd_a" "$session_a_new" \
  2024-01-01T00:00:01Z session-a-old "Alpha old" "$cwd_a" "$session_a_old"
[[ $filtered_output == "$expected_filtered" ]]

new_format_output=$(OMP_SESSIONS_DIR="$sessions_root" omp-transcript list -n 4)
printf -v expected_new_format_row '%s\t%s\t%s\t%s\t%s' \
  2023-12-31T00:00:00Z session-b-new-format "Beta title record" "$cwd_b" "$session_b_new_format"
[[ $new_format_output == *$'\n'"$expected_new_format_row" ]]


# 10. Message slicing counts renderable records, keeps an assistant record's
# sections together, composes with hydration, and validates its argument.
slice_session="$tmp/slice.jsonl"
cat >"$slice_session" <<'EOF'
{"type":"message","id":"slice-1","parentId":null,"message":{"role":"user","content":[{"type":"text","text":"SLICE ONE"}]}}
{"type":"message","id":"slice-empty","parentId":"slice-1","message":{"role":"assistant","content":[{"type":"thinking","thinking":""}]}}
{"type":"message","id":"slice-2","parentId":"slice-empty","message":{"role":"assistant","content":[{"type":"thinking","thinking":"SLICE TWO REASONING"},{"type":"text","text":"SLICE TWO ANSWER"}]}}
{"type":"custom_message","id":"slice-3","parentId":"slice-2","customType":"slice-three","content":"SLICE THREE"}
{"type":"message","id":"slice-4","parentId":"slice-3","message":{"role":"assistant","content":[{"type":"text","text":"SLICE FOUR"}]}}
{"type":"message","id":"slice-5","parentId":"slice-4","message":{"role":"toolResult","toolName":"bash","isError":false,"content":[{"type":"text","text":"recorded marker\n[raw output: artifact://9]\n\nWall time: 0.01 seconds"}]}}
EOF
slice_dir="${slice_session%.jsonl}"
mkdir -p "$slice_dir"
printf '%s' 'HYDRATED SLICE FIVE' >"$slice_dir/9.bash-original.log"

first_two=$(omp-transcript -m 2 "$slice_session")
printf -v expected_first_two \
  '# OMP transcript\n\n- **Source:** `%s`\n- **Branch:** active branch only\n- **Messages:** first 2 of 4\n\n<user>\nSLICE ONE\n</user>\n\n<assistant>\nSLICE TWO ANSWER\n</assistant>' \
  "$slice_session"
[[ $first_two == "$expected_first_two" ]]
[[ $first_two != *"SLICE THREE"* && $first_two != *"SLICE FOUR"* ]]

last_two=$(omp-transcript "$slice_session" --messages -2)
[[ $last_two == *$'- **Messages:** last 2 of 4\n'* ]]
[[ $last_two == *$'<custom-message type="slice-three">\nSLICE THREE\n</custom-message>'* ]]
[[ $last_two == *$'<assistant>\nSLICE FOUR\n</assistant>'* ]]
[[ $last_two != *"<tool-result "* ]]
[[ $last_two != *"SLICE ONE"* && $last_two != *"SLICE TWO"* ]]

first_two_reasoned=$(omp-transcript -m 2 "$slice_session" --reasoning)
[[ $first_two_reasoned == *$'- **Messages:** first 2 of 4\n'* ]]
[[ $first_two_reasoned == *$'<reasoning>\nSLICE TWO REASONING\n</reasoning>\n\n<assistant>\nSLICE TWO ANSWER\n</assistant>'* ]]

whole_slice=$(omp-transcript "$slice_session")
clamped_slice=$(omp-transcript "$slice_session" -m -999)
[[ $clamped_slice == *$'- **Messages:** last 4 of 4\n'* ]]
clamped_without_header=${clamped_slice/$'- **Messages:** last 4 of 4\n'/}
[[ $clamped_without_header == "$whole_slice" ]]

hydrated_last=$(omp-transcript -m -1 --hydrate "$slice_session")
[[ $hydrated_last == *$'- **Messages:** last 1 of 5\n'* ]]
[[ $hydrated_last == *"HYDRATED SLICE FIVE"* ]]
[[ $hydrated_last != *"recorded marker"* ]]
[[ $hydrated_last != *"SLICE ONE"* && $hydrated_last != *"SLICE TWO"* ]]
[[ $hydrated_last != *"SLICE THREE"* && $hydrated_last != *"SLICE FOUR"* ]]

# An assistant record containing only tool calls vanishes from the default
# render and does not consume a slice slot.
tool_only_session="$tmp/tool-only.jsonl"
cat >"$tool_only_session" <<'EOF'
{"type":"message","id":"tool-only-first","parentId":null,"message":{"role":"user","content":[{"type":"text","text":"TOOL-ONLY FIRST"}]}}
{"type":"message","id":"tool-only-call","parentId":"tool-only-first","message":{"role":"assistant","content":[{"type":"toolCall","name":"read","arguments":{"path":"hidden.txt"}}]}}
{"type":"message","id":"tool-only-second","parentId":"tool-only-call","message":{"role":"assistant","content":[{"type":"text","text":"TOOL-ONLY SECOND"}]}}
EOF
tool_only_slice=$(omp-transcript "$tool_only_session" -m 2)
[[ $tool_only_slice == *$'- **Messages:** first 2 of 2\n'* ]]
[[ $tool_only_slice == *$'<user>\nTOOL-ONLY FIRST\n</user>'* ]]
[[ $tool_only_slice == *$'<assistant>\nTOOL-ONLY SECOND\n</assistant>'* ]]
[[ $tool_only_slice != *"<tool-call "* ]]

set +e
omp-transcript "$slice_session" -m 0 >"$tmp/messages-zero.stdout" 2>"$tmp/messages-zero.stderr"
messages_zero_status=$?
omp-transcript "$slice_session" -m x >"$tmp/messages-x.stdout" 2>"$tmp/messages-x.stderr"
messages_x_status=$?
omp-transcript "$slice_session" -m >"$tmp/messages-missing.stdout" 2>"$tmp/messages-missing.stderr"
messages_missing_status=$?
omp-transcript list -m 3 >"$tmp/list-messages.stdout" 2>"$tmp/list-messages.stderr"
list_messages_status=$?
set -e
[[ $messages_zero_status -eq 2 ]]
[[ $messages_x_status -eq 2 ]]
[[ $messages_missing_status -eq 2 ]]
[[ $list_messages_status -eq 2 ]]

# 11. Unknown flags and tool flags in non-render modes are usage errors.
expected_usage=$(omp-transcript --help 2>&1)
set +e
omp-transcript --bogus >"$tmp/bogus.stdout" 2>"$tmp/bogus.stderr"
bogus_status=$?
omp-transcript "$session" --bogus >"$tmp/trailing-bogus.stdout" 2>"$tmp/trailing-bogus.stderr"
trailing_bogus_status=$?
OMP_SESSIONS_DIR="$sessions_root" omp-transcript list -n 18446744073709551616 \
  >"$tmp/overflow.stdout" 2>"$tmp/overflow.stderr"
overflow_status=$?
omp-transcript result --hydrate --session "$session" --message-id active-result \
  >"$tmp/result-hydrate.stdout" 2>"$tmp/result-hydrate.stderr"
result_hydrate_status=$?
OMP_SESSIONS_DIR="$sessions_root" omp-transcript list --hydrate \
  >"$tmp/list-hydrate.stdout" 2>"$tmp/list-hydrate.stderr"
list_hydrate_status=$?
omp-transcript result --reasoning --session "$session" --message-id active-result \
  >"$tmp/result-reasoning.stdout" 2>"$tmp/result-reasoning.stderr"
result_reasoning_status=$?
OMP_SESSIONS_DIR="$sessions_root" omp-transcript list --reasoning \
  >"$tmp/list-reasoning.stdout" 2>"$tmp/list-reasoning.stderr"
list_reasoning_status=$?
omp-transcript search --hydrate needle >"$tmp/search-hydrate.stdout" 2>"$tmp/search-hydrate.stderr"
search_hydrate_status=$?
omp-transcript search >"$tmp/search-missing.stdout" 2>"$tmp/search-missing.stderr"
search_missing_status=$?
set -e
[[ $bogus_status -eq 2 ]]
[[ $(<"$tmp/bogus.stderr") == "$expected_usage" ]]
[[ $trailing_bogus_status -eq 2 ]]
[[ $(<"$tmp/trailing-bogus.stderr") == "$expected_usage" ]]
[[ $overflow_status -eq 2 ]]
[[ $(<"$tmp/overflow.stderr") == "$expected_usage" ]]
[[ $result_hydrate_status -eq 2 ]]
[[ $(<"$tmp/result-hydrate.stderr") == "$expected_usage" ]]
[[ $list_hydrate_status -eq 2 ]]
[[ $(<"$tmp/list-hydrate.stderr") == "$expected_usage" ]]
[[ $result_reasoning_status -eq 2 ]]
[[ $(<"$tmp/result-reasoning.stderr") == "$expected_usage" ]]
[[ $list_reasoning_status -eq 2 ]]
[[ $(<"$tmp/list-reasoning.stderr") == "$expected_usage" ]]
[[ $search_hydrate_status -eq 2 ]]
[[ $(<"$tmp/search-hydrate.stderr") == "$expected_usage" ]]
[[ $search_missing_status -eq 2 ]]
[[ $(<"$tmp/search-missing.stderr") == "$expected_usage" ]]

# 12. A valid large list limit returns every row of the small fixture.
large_limit_output=$(OMP_SESSIONS_DIR="$sessions_root" omp-transcript list -n 999999999)
[[ $large_limit_output == "$new_format_output" ]]
# 13. Session id / id-prefix resolution stands in for a path.
id_root="$tmp/id root"
id_project="$id_root/project"
mkdir -p "$id_project"
id_alpha=019aaaaa-1111-7000-8000-000000000001
id_amb_one=019cccc0-3333-7000-8000-000000000003
id_amb_two=019cccc1-4444-7000-8000-000000000004
write_id_session() {
  local path=$1 sid=$2 marker=$3
  {
    printf '{"type":"session","id":"%s","cwd":"/tmp/idcwd","title":"T","timestamp":"2026-01-01T00:00:00Z"}\n' "$sid"
    printf '{"type":"message","id":"u1","parentId":null,"message":{"role":"user","content":[{"type":"text","text":"%s"}]}}\n' "$marker"
    printf '{"type":"message","id":"tr1","parentId":"u1","message":{"role":"toolResult","toolName":"bash","isError":false,"content":[{"type":"text","text":"%s-result"}]}}\n' "$marker"
  } >"$path"
}
write_id_session "$id_project/2026-01-01T00-00-00-000Z_$id_alpha.jsonl" "$id_alpha" ALPHA
write_id_session "$id_project/2026-01-02T00-00-00-000Z_$id_amb_one.jsonl" "$id_amb_one" AMB1
write_id_session "$id_project/2026-01-03T00-00-00-000Z_$id_amb_two.jsonl" "$id_amb_two" AMB2

full_id_render=$(OMP_SESSIONS_DIR="$id_root" omp-transcript "$id_alpha")
[[ $full_id_render == *ALPHA* ]]
[[ $full_id_render != *AMB1* ]]
prefix_render=$(OMP_SESSIONS_DIR="$id_root" omp-transcript 019aaaaa)
[[ $prefix_render == *ALPHA* ]]
id_result=$(OMP_SESSIONS_DIR="$id_root" omp-transcript result --session "$id_alpha" --message-id tr1)
[[ $id_result == "ALPHA-result" ]]

set +e
OMP_SESSIONS_DIR="$id_root" omp-transcript 019cccc >"$tmp/amb.stdout" 2>"$tmp/amb.stderr"
amb_status=$?
OMP_SESSIONS_DIR="$id_root" omp-transcript 019ffff-0000-7000-8000-000000000009 \
  >"$tmp/noid.stdout" 2>"$tmp/noid.stderr"
noid_status=$?
OMP_SESSIONS_DIR="$id_root" omp-transcript nope >"$tmp/nopath.stdout" 2>"$tmp/nopath.stderr"
nopath_status=$?
set -e
[[ $amb_status -eq 1 ]]
[[ $(<"$tmp/amb.stderr") == *"ambiguous session id: 019cccc"* ]]
[[ $(<"$tmp/amb.stderr") == *"$id_amb_one"* ]]
[[ $(<"$tmp/amb.stderr") == *"$id_amb_two"* ]]
[[ $noid_status -eq 1 ]]
[[ $(<"$tmp/noid.stderr") == *"no session with id"* ]]
[[ $nopath_status -eq 1 ]]
[[ $(<"$tmp/nopath.stderr") == *"session not found: nope"* ]]

# 14. search scans visible text, never falls through to resolve_session, and
# honours the same cwd / profile / visibility flags as the rest of the tool.
search_root="$tmp/search-root"
search_proj="$search_root/proj"
search_cwd="$tmp/search-cwd"
search_other="$tmp/search-other"
mkdir -p "$search_proj" "$search_cwd" "$search_other"
search_cwd=$(realpath "$search_cwd")
search_other=$(realpath "$search_other")

user_path="$search_proj/2026-01-10T00-00-00-000Z_search-user.jsonl"
think_path="$search_proj/2026-01-09T00-00-00-000Z_search-think.jsonl"
tool_path="$search_proj/2026-01-08T00-00-00-000Z_search-tool.jsonl"
abandon_path="$search_proj/2026-01-07T00-00-00-000Z_search-abandon.jsonl"
other_cwd_path="$search_proj/2026-01-06T00-00-00-000Z_search-othercwd.jsonl"
title_path="$search_proj/2026-01-05T00-00-00-000Z_search-title.jsonl"
dash_path="$search_proj/2026-01-04T00-00-00-000Z_search-dash.jsonl"
trunc_path="$search_proj/2026-01-03T00-00-00-000Z_search-trunc.jsonl"
noid_path="$search_proj/2026-01-02T00-00-00-000Z_fallback-id.jsonl"
dot_path="$search_proj/2026-01-01T00-00-00-000Z_search-dot.jsonl"

jq -cn --arg id search-user --arg cwd "$search_cwd" --arg title "User session" \
  '{type:"session",id:$id,cwd:$cwd,title:$title}' >"$user_path"
jq -cn '{type:"message",id:"u1",parentId:null,message:{role:"user",content:[{type:"text",text:"UNIQUE_USER_NEEDLE one"}]}}' >>"$user_path"
jq -cn '{type:"message",id:"u2",parentId:"u1",message:{role:"user",content:[{type:"text",text:"UNIQUE_USER_NEEDLE two"}]}}' >>"$user_path"

jq -cn --arg id search-think --arg cwd "$search_cwd" --arg title "Think session" \
  '{type:"session",id:$id,cwd:$cwd,title:$title}' >"$think_path"
jq -cn '{type:"message",id:"u1",parentId:null,message:{role:"user",content:[{type:"text",text:"unrelated user"}]}}' >>"$think_path"
jq -cn '{type:"message",id:"a1",parentId:"u1",message:{role:"assistant",content:[{type:"thinking",thinking:"THINKING_NEEDLE hidden"},{type:"text",text:"visible reply"}]}}' >>"$think_path"

jq -cn --arg id search-tool --arg cwd "$search_cwd" --arg title "Tool session" \
  '{type:"session",id:$id,cwd:$cwd,title:$title}' >"$tool_path"
jq -cn '{type:"message",id:"u1",parentId:null,message:{role:"user",content:[{type:"text",text:"unrelated user"}]}}' >>"$tool_path"
jq -cn '{type:"message",id:"a1",parentId:"u1",message:{role:"assistant",content:[{type:"toolCall",name:"bash",arguments:{cmd:"TOOLCALL_NEEDLE"}}]}}' >>"$tool_path"
jq -cn '{type:"message",id:"r1",parentId:"a1",message:{role:"toolResult",toolName:"bash",isError:false,content:[{type:"text",text:"TOOLRESULT_NEEDLE"}]}}' >>"$tool_path"

jq -cn --arg id search-abandon --arg cwd "$search_cwd" --arg title "Abandon session" \
  '{type:"session",id:$id,cwd:$cwd,title:$title}' >"$abandon_path"
jq -cn '{type:"message",id:"u1",parentId:null,message:{role:"user",content:[{type:"text",text:"root"}]}}' >>"$abandon_path"
jq -cn '{type:"message",id:"old-a",parentId:"u1",message:{role:"assistant",content:[{type:"text",text:"ABANDONED_NEEDLE"}]}}' >>"$abandon_path"
jq -cn '{type:"message",id:"active-a",parentId:"u1",message:{role:"assistant",content:[{type:"text",text:"active path"}]}}' >>"$abandon_path"

jq -cn --arg id search-othercwd --arg cwd "$search_other" --arg title "Other cwd" \
  '{type:"session",id:$id,cwd:$cwd,title:$title}' >"$other_cwd_path"
jq -cn '{type:"message",id:"u1",parentId:null,message:{role:"user",content:[{type:"text",text:"UNIQUE_USER_NEEDLE other cwd"}]}}' >>"$other_cwd_path"

jq -cn --arg id search-title --arg cwd "$search_cwd" --arg title "TITLE_NEEDLE session" \
  '{type:"session",id:$id,cwd:$cwd,title:$title}' >"$title_path"

jq -cn --arg id search-dash --arg cwd "$search_cwd" --arg title "Dash session" \
  '{type:"session",id:$id,cwd:$cwd,title:$title}' >"$dash_path"
jq -cn '{type:"message",id:"u1",parentId:null,message:{role:"user",content:[{type:"text",text:"flag -n value"}]}}' >>"$dash_path"

jq -cn --arg id search-trunc --arg cwd "$search_cwd" --arg title "Trunc session" \
  '{type:"session",id:$id,cwd:$cwd,title:$title}' >"$trunc_path"
jq -cn '{type:"message",id:"u1",parentId:null,message:{role:"user",content:[{type:"text",text:"TRUNCATED_NEEDLE"}]}}' >>"$trunc_path"
printf '%s' '{"type":"message","id":"broken"' >>"$trunc_path"

jq -cn '{type:"message",id:"u1",parentId:null,message:{role:"user",content:[{type:"text",text:"FALLBACK_NEEDLE"}]}}' >"$noid_path"

jq -cn --arg id search-dot --arg cwd "$search_cwd" --arg title "Dot session" \
  '{type:"session",id:$id,cwd:$cwd,title:$title}' >"$dot_path"
jq -cn '{type:"message",id:"u1",parentId:null,message:{role:"user",content:[{type:"text",text:"fooXbar"}]}}' >>"$dot_path"

touch -d 2026-01-10T00:00:00Z "$user_path"
touch -d 2026-01-09T00:00:00Z "$think_path"
touch -d 2026-01-08T00:00:00Z "$tool_path"
touch -d 2026-01-07T00:00:00Z "$abandon_path"
touch -d 2026-01-06T00:00:00Z "$other_cwd_path"
touch -d 2026-01-05T00:00:00Z "$title_path"
touch -d 2026-01-04T00:00:00Z "$dash_path"
touch -d 2026-01-03T00:00:00Z "$trunc_path"
touch -d 2026-01-02T00:00:00Z "$noid_path"
touch -d 2026-01-01T00:00:00Z "$dot_path"

# The original regression: `search` must not be treated as a session id.
set +e
OMP_SESSIONS_DIR="$search_root" omp-transcript search UNIQUE_USER_NEEDLE --no-snippet \
  >"$tmp/search-user.stdout" 2>"$tmp/search-user.stderr"
search_user_status=$?
set -e
[[ $search_user_status -eq 0 ]]
[[ $(<"$tmp/search-user.stderr") != *"session not found"* ]]
[[ $(<"$tmp/search-user.stdout") == *$'\tsearch-user\t2\tUser session\t'"$search_cwd"$'\t'"$user_path"* ]]
[[ $(<"$tmp/search-user.stdout") == *$'\tsearch-othercwd\t1\tOther cwd\t'"$search_other"$'\t'"$other_cwd_path"* ]]
[[ $(<"$tmp/search-user.stdout") != *search-think* ]]

# Newest first, hit counts, default snippet prefers a user match.
search_user_snip=$(OMP_SESSIONS_DIR="$search_root" omp-transcript search unique_user_needle -n 1)
[[ $search_user_snip == 2026-01-10T00:00:00Z$'\tsearch-user\t2\tUser session\t'"$search_cwd"$'\t'"$user_path"$'\tuser: UNIQUE_USER_NEEDLE one' ]]
OMP_SESSIONS_DIR="$search_root" omp-transcript search UNIQUE_USER_NEEDLE -n 1 --no-snippet \
  >"$tmp/search-n1.stdout" 2>"$tmp/search-n1.stderr"
[[ $(<"$tmp/search-n1.stderr") == "omp-transcript: 2 sessions matched, showing 1 (raise with -n, 0 for all)" ]]
search_all=$(OMP_SESSIONS_DIR="$search_root" omp-transcript search UNIQUE_USER_NEEDLE -n 0 --no-snippet)
[[ $(printf '%s\n' "$search_all" | wc -l) -eq 2 ]]

# --cwd is an exact realpath match.
search_cwd_out=$(OMP_SESSIONS_DIR="$search_root" omp-transcript search UNIQUE_USER_NEEDLE --cwd "$search_cwd" --no-snippet)
[[ $search_cwd_out == *$'\tsearch-user\t'* ]]
[[ $search_cwd_out != *search-othercwd* ]]

# Titles match; reasoning and tool traffic do not unless asked.
search_title=$(OMP_SESSIONS_DIR="$search_root" omp-transcript search TITLE_NEEDLE --no-snippet)
[[ $search_title == *$'\tsearch-title\t1\tTITLE_NEEDLE session\t'* ]]
search_think_default=$(OMP_SESSIONS_DIR="$search_root" omp-transcript search THINKING_NEEDLE --no-snippet)
[[ -z $search_think_default ]]
search_think=$(OMP_SESSIONS_DIR="$search_root" omp-transcript search THINKING_NEEDLE --reasoning --no-snippet)
[[ $search_think == *$'\tsearch-think\t1\tThink session\t'* ]]
search_tool_default=$(OMP_SESSIONS_DIR="$search_root" omp-transcript search TOOLRESULT_NEEDLE --no-snippet)
[[ -z $search_tool_default ]]
search_tool=$(OMP_SESSIONS_DIR="$search_root" omp-transcript search TOOLRESULT_NEEDLE --with-tools --no-snippet)
[[ $search_tool == *$'\tsearch-tool\t1\tTool session\t'* ]]
search_call=$(OMP_SESSIONS_DIR="$search_root" omp-transcript search TOOLCALL_NEEDLE --with-tools --no-snippet)
[[ $search_call == *$'\tsearch-tool\t1\tTool session\t'* ]]

# Abandoned branches are still searched.
search_abandon=$(OMP_SESSIONS_DIR="$search_root" omp-transcript search ABANDONED_NEEDLE --no-snippet)
[[ $search_abandon == *$'\tsearch-abandon\t1\tAbandon session\t'* ]]

# Live truncated last line is retried; missing session header falls back to the filename.
search_trunc=$(OMP_SESSIONS_DIR="$search_root" omp-transcript search TRUNCATED_NEEDLE --no-snippet)
[[ $search_trunc == *$'\tsearch-trunc\t1\tTrunc session\t'* ]]
search_fallback=$(OMP_SESSIONS_DIR="$search_root" omp-transcript search FALLBACK_NEEDLE --no-snippet)
[[ $search_fallback == *$'\tfallback-id\t1\t-\t\t'"$noid_path" ]]

# Literal vs regex, dash patterns, invalid regex, empty haystack.
search_dot_lit=$(OMP_SESSIONS_DIR="$search_root" omp-transcript search 'foo.bar' --no-snippet)
[[ -z $search_dot_lit ]]
search_dot_re=$(OMP_SESSIONS_DIR="$search_root" omp-transcript search --regex 'foo.bar' --no-snippet)
[[ $search_dot_re == *$'\tsearch-dot\t1\tDot session\t'* ]]
search_dash=$(OMP_SESSIONS_DIR="$search_root" omp-transcript search -- -n --no-snippet)
[[ $search_dash == *$'\tsearch-dash\t1\tDash session\t'* ]]
search_none=$(OMP_SESSIONS_DIR="$search_root" omp-transcript search NO_SUCH_TOKEN --no-snippet)
[[ -z $search_none ]]
set +e
OMP_SESSIONS_DIR="$search_root" omp-transcript search --regex '(' \
  >"$tmp/search-badre.stdout" 2>"$tmp/search-badre.stderr"
search_badre_status=$?
set -e
[[ $search_badre_status -eq 1 ]]
[[ $(<"$tmp/search-badre.stderr") == "omp-transcript: invalid regex: (" ]]
[[ -z $(<"$tmp/search-badre.stdout") ]]

# --profile selects sessions roots independently of OMP_SESSIONS_DIR.
profile_home="$tmp/profile-home"
mkdir -p "$profile_home/.omp/agent/sessions/proj" \
  "$profile_home/.omp/profiles/nilo/agent/sessions/proj"
default_path="$profile_home/.omp/agent/sessions/proj/2026-02-01T00-00-00-000Z_profile-default.jsonl"
nilo_path="$profile_home/.omp/profiles/nilo/agent/sessions/proj/2026-02-02T00-00-00-000Z_profile-nilo.jsonl"
jq -cn --arg id profile-default --arg cwd "$search_cwd" --arg title "Default profile" \
  '{type:"session",id:$id,cwd:$cwd,title:$title}' >"$default_path"
jq -cn '{type:"message",id:"u1",parentId:null,message:{role:"user",content:[{type:"text",text:"DEFAULT_ONLY SHARED_TOKEN"}]}}' >>"$default_path"
jq -cn --arg id profile-nilo --arg cwd "$search_cwd" --arg title "Nilo profile" \
  '{type:"session",id:$id,cwd:$cwd,title:$title}' >"$nilo_path"
jq -cn '{type:"message",id:"u1",parentId:null,message:{role:"user",content:[{type:"text",text:"NILO_ONLY SHARED_TOKEN"}]}}' >>"$nilo_path"
touch -d 2026-02-01T00:00:00Z "$default_path"
touch -d 2026-02-02T00:00:00Z "$nilo_path"

profile_default=$(HOME="$profile_home" OMP_SESSIONS_DIR="$search_root" omp-transcript search DEFAULT_ONLY --profile default --no-snippet)
[[ $profile_default == *$'\tprofile-default\t'* ]]
[[ $profile_default != *profile-nilo* ]]
profile_nilo=$(HOME="$profile_home" omp-transcript search NILO_ONLY --profile nilo --no-snippet)
[[ $profile_nilo == *$'\tprofile-nilo\t'* ]]
[[ $profile_nilo != *profile-default* ]]
profile_all=$(HOME="$profile_home" omp-transcript search SHARED_TOKEN --profile all --no-snippet)
[[ $profile_all == *$'\tprofile-nilo\t'* ]]
[[ $profile_all == *$'\tprofile-default\t'* ]]
set +e
HOME="$profile_home" omp-transcript search SHARED_TOKEN --profile missing \
  >"$tmp/search-prof.stdout" 2>"$tmp/search-prof.stderr"
search_prof_status=$?
set -e
[[ $search_prof_status -eq 1 ]]
[[ $(<"$tmp/search-prof.stderr") == "omp-transcript: profile not found: missing" ]]

# Snippets stay on one line and honour --width.
search_width=$(OMP_SESSIONS_DIR="$search_root" omp-transcript search UNIQUE_USER_NEEDLE -n 1 --width 10)
[[ $search_width == *$'\tuser: UNIQUE_USE…' ]]
[[ $(printf '%s\n' "$search_width" | wc -l) -eq 1 ]]

printf 'PASS: render, hydration, slicing, dynamic fences, list mode, id resolution, and search\n'

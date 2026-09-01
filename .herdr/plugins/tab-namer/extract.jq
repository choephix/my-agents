fromjson?
| (.message // .payload // .) as $m
| select(($m | type) == "object")
| ($m.role // empty) as $r
| select($r == "user" or $r == "assistant")
| ($m.content
   | if type == "string" then .
     elif type == "array" then
       ([ .[] | objects
          | select(.type == "text" or .type == "input_text" or .type == "output_text")
          | .text // empty ] | join("\n"))
     else "" end) as $t
| select(($t | length) > 0)
| "\($r): \($t[0:600])"

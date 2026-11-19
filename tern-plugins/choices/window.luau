-- Choices: a Markdown link [label](<@prompt>) in an omp reply is a choice.
-- Clicking it puts "> prompt" in that omp's composer as its own paragraph; it never sends.
-- Picking another choice of the same question replaces that line; picking the same one again removes it.

local QUOTE = "> "

local function utf16_len(s: string): number
	local n = 0
	for _, c in utf8.codes(s) do
		n += if c > 0xFFFF then 2 else 1
	end
	return n
end

local function percent_decode(s: string): string
	return (s:gsub("%%(%x%x)", function(h)
		return string.char(tonumber(h, 16) :: number)
	end))
end

-- First node of kind `k` in a TSP wire tree, depth first.
local function find_kind(node: any, k: string): any
	if type(node) ~= "table" then
		return nil
	end
	if node.k == k then
		return node
	end
	for _, child in node.c or {} do
		local hit = find_kind(child, k)
		if hit then
			return hit
		end
	end
	return nil
end

local function collect_md(node: any, out: { string })
	if type(node) ~= "table" then
		return
	end
	if node.k == "md" and node.p and type(node.p.text) == "string" then
		table.insert(out, node.p.text)
	end
	for _, child in node.c or {} do
		collect_md(child, out)
	end
end

local function targets_in(line: string, out: { string })
	for t in line:gmatch("%]%(<(@[^>]*)>%)") do
		table.insert(out, t)
	end
	for t in line:gmatch("%]%((@[^%s%)<>]*)%)") do
		table.insert(out, t)
	end
end

-- Blank also when it holds only quote markers: an embedded memo arrives quoted ("> "), and its
-- paragraph breaks are ">" lines.
local function has_text(line: string): boolean
	return line:find("[^>%s]") ~= nil
end

-- The choice targets of the question `url` belongs to: every choice in the run of
-- non-blank lines (a paragraph or a list) holding it, in the newest reply that has it.
local function question_of(main: any, url: string): { string }
	local sources = {}
	collect_md(main, sources)
	local needles = { "](<" .. url .. ">)", "](" .. url .. ")" }
	for i = #sources, 1, -1 do
		local lines = sources[i]:split("\n")
		for at, line in lines do
			if line:find(needles[1], 1, true) or line:find(needles[2], 1, true) then
				local first, last = at, at
				while first > 1 and has_text(lines[first - 1]) do
					first -= 1
				end
				while last < #lines and has_text(lines[last + 1]) do
					last += 1
				end
				local found = {}
				for j = first, last do
					targets_in(lines[j], found)
				end
				return found
			end
		end
	end
	return {}
end

-- The composer text after picking `line`, whose question's lines are `siblings`. A new quote gets a blank
-- line above it when the composer has text. When the text ends in a quote, a blank line follows it with the
-- caret after, so typing starts a new paragraph, not more quote.
local function picked(text: string, line: string, siblings: { [string]: boolean }): string
	local lines = if text == "" then {} else text:split("\n")
	local placed = false
	for i, l in lines do
		if l == line then
			table.remove(lines, i)
			-- Removing a quote leaves the blank lines around it; drop one so no double gap remains.
			if lines[i] == "" and (i == 1 or lines[i - 1] == "") then
				table.remove(lines, i)
			end
			placed = true
			break
		end
	end
	if not placed then
		for i, l in lines do
			if siblings[l] then
				lines[i] = line
				placed = true
				break
			end
		end
	end
	while #lines > 0 and lines[#lines] == "" do
		table.remove(lines)
	end
	if not placed then
		if #lines > 0 then
			table.insert(lines, "")
		end
		table.insert(lines, line)
	end
	if #lines > 0 and lines[#lines]:sub(1, #QUOTE) == QUOTE then
		table.insert(lines, "")
		table.insert(lines, "")
	end
	return table.concat(lines, "\n")
end

-- Picked state: a choice whose "> prompt" is a line of its pane's composer draws picked. Tern sends
-- plugins no event when the composer changes, so each pane's lines are re-read on a choice click and
-- dropped once its agent starts working (the message was sent).
local picked_by_pane: { [number]: { string } } = {}

local function css_string(s: string): string
	return '"' .. s:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\a ") .. '"'
end

local function restyle_picked()
	local selectors = {}
	for _, prompts in picked_by_pane do
		for _, prompt in prompts do
			-- `.sf-md >` outranks the muted rule in choices.css, so a picked choice in an older reply still shows picked.
			local a = '[data-surface="omp.session"] .sf-md > .md a[href=' .. css_string("@" .. prompt) .. "]"
			table.insert(selectors, a)
			table.insert(selectors, a .. ":hover")
		end
	end
	local css = if #selectors == 0
		then ""
		else table.concat(selectors, ",\n")
			.. " { background: #facc15 content-box !important; color: #000; --choice-code-bg: none; }"
	tern.css("picked", css)
end

local function set_picked(pane: number, text: string)
	local prompts = {}
	for _, line in text:split("\n") do
		if line:sub(1, #QUOTE) == QUOTE and #line > #QUOTE then
			table.insert(prompts, line:sub(#QUOTE + 1))
		end
	end
	picked_by_pane[pane] = if #prompts > 0 then prompts else nil
	restyle_picked()
end

tern.on("agent_state", function(ev, _cx)
	if ev.new == "working" and picked_by_pane[ev.pane] then
		picked_by_pane[ev.pane] = nil
		restyle_picked()
	end
end)

tern.on("pane_closed", function(ev, _cx)
	if picked_by_pane[ev.pane] then
		picked_by_pane[ev.pane] = nil
		restyle_picked()
	end
end)

tern.route.link(function(link, cx)
	if link.pane == nil or link.url:sub(1, 1) ~= "@" then
		return nil
	end
	local tree = cx.session:surface(link.pane, { nodes = 5000 })
	if type(tree) ~= "table" or tree.surface == nil or tree.surface.role ~= "omp.session" then
		return nil
	end
	local prompt = percent_decode(link.url:sub(2))
	if not prompt:match("%S") then
		cx:toast("error", "Empty choice", "Write the prompt after the @")
		return { handled = true }
	end
	local editor = find_kind(tree.dock, "editor")
	if editor == nil or editor.p == nil then
		cx:toast("error", "No omp composer found", "The choice was not inserted")
		return { handled = true }
	end

	local siblings = {}
	for _, t in question_of(tree.main, link.url) do
		siblings[QUOTE .. percent_decode(t:sub(2))] = true
	end
	local old = editor.p.text or ""
	local new = picked(old, QUOTE .. prompt, siblings)
	local new_len = utf16_len(new)
	cx.session:event(link.pane, {
		ev = "edit",
		sf = tree.surface.id,
		id = editor.id,
		from = 0,
		to = utf16_len(old),
		text = new,
		cursor = new_len,
		len = utf16_len(old),
	})
	set_picked(link.pane, new)
	return { handled = true }
end)

-- Theme rules: Tern's theme follows an ordered list of rules, each matching the
-- focused omp's profile, the current session and its host. The list is a JSON
-- file fetched over HTTP, so agents on the server can change it; its URL is set
-- once per machine with "Theme rules: set rules URL".

local REFETCH_MS = 5000
local SLOTS = { theme = "theme_dark", light = "theme_light" }

-- rules.json: { "dirs": { "<dir>": "<profile>" }, "rules": [ { "host"?, "session"?, "profile"?, "theme"?, "light"? } ] }
local doc = tern.kv.get("doc") or { rules = {} }
local fetched_at = -math.huge
local fetching = false
local fetch_error: string? = nil

local function lower(s: string?): string?
	return if s then string.lower(s) else nil
end

-- Tern names a remote host as it was added (`cx@server`, `ark:2222`); rules name the machine.
local function machine(s: string?): string?
	return if s then lower((s:gsub("^.*@", ""):gsub(":%d+$", ""))) else nil
end

-- `--profile X`, `OMP_PROFILE=X` or `PI_PROFILE=X` in a command line, and whether it runs omp at all.
local function profile_in(line: string?): (boolean, string?)
	if not line then
		return false, nil
	end
	local runs = false
	for word in line:gmatch("%S+") do
		if word == "omp" or word:sub(-4) == "/omp" then
			runs = true
		end
	end
	if not runs then
		return false, nil
	end
	return true, line:match("%-%-profile[=%s]+([%w%._%-]+)")
		or line:match("OMP_PROFILE=[\"']?([%w%._%-]+)")
		or line:match("PI_PROFILE=[\"']?([%w%._%-]+)")
end

-- What the omp() shell wrapper picks for a bare `omp`: a directory named `<dir>`
-- or `<dir>-*` on the way up selects `dirs[dir]`.
local function profile_of_dir(cwd: string?): string
	for part in (cwd or ""):gmatch("[^/\\]+") do
		for dir, profile in doc.dirs or {} do
			if part == dir or part:sub(1, #dir + 1) == dir .. "-" then
				return profile
			end
		end
	end
	return "default"
end

-- The profile of the omp in `pane`; nil when it runs no omp.
local function omp_profile(cx, pane: number?): string?
	local info = pane and cx.session:pane(pane)
	if not info then
		return nil
	end
	local lines = {}
	if info.running then
		table.insert(lines, info.running.line)
	end
	for _, agent in cx.agents:list() do
		if agent.pane == pane and type(agent.command) == "string" then
			table.insert(lines, agent.command)
		end
	end
	table.insert(lines, info.program)
	local runs = false
	for _, line in lines do
		local here, profile = profile_in(line)
		if profile then
			return profile
		end
		runs = runs or here
	end
	return if runs then profile_of_dir(info.cwd) else nil
end

local function context(cx)
	return {
		host = cx.hosts:current().name,
		session = cx.sessions:current().name,
		profile = omp_profile(cx, cx.session:focused()),
	}
end

local warned = {}

local function installed(cx, rule): boolean
	local names = {}
	for _, name in cx.settings:themes() do
		names[name] = true
	end
	for field in SLOTS do
		local theme = rule[field]
		if theme and not names[theme] then
			if not warned[theme] then
				warned[theme] = true
				cx:toast("error", `Theme rules: Tern has no theme "{theme}"`, "Settings › Appearance lists the names")
			end
			return false
		end
	end
	return true
end

-- The first rule whose every condition holds, and its position.
local function match(cx, ctx): (number?, any)
	for i, rule in doc.rules or {} do
		if (rule.host == nil or machine(rule.host) == machine(ctx.host))
			and (rule.session == nil or lower(rule.session) == lower(ctx.session))
			and (rule.profile == nil or lower(rule.profile) == lower(ctx.profile))
			and installed(cx, rule)
		then
			return i, rule
		end
	end
	return nil, nil
end

-- Pins `key` to `want`, or puts back the theme the user had picked when no rule wants one.
-- A value the plugin didn't write is the user's own choice: it becomes the one to put back.
local function set_slot(cx, key: string, want: string?)
	local current = cx.settings:get(key)
	if current ~= tern.kv.get("wrote." .. key) then
		tern.kv.set("base." .. key, current)
	end
	local target = want or tern.kv.get("base." .. key)
	if current ~= target then
		cx.settings:set(key, target)
	end
	tern.kv.set("wrote." .. key, target)
end

local function apply(cx)
	local ctx = context(cx)
	local i, rule = match(cx, ctx)
	for field, key in SLOTS do
		set_slot(cx, key, rule and rule[field])
	end
	return ctx, i, rule
end

local function refresh(cx, force: boolean)
	local url = tern.kv.get("url")
	if not url then
		fetch_error = "no rules URL: palette › Theme rules: set rules URL"
		return
	end
	if fetching or (not force and tern.now() - fetched_at < REFETCH_MS) then
		return
	end
	fetching = true
	tern.fetch(url, { timeout_ms = 3000 }, function(res, later)
		fetching = false
		fetched_at = tern.now()
		if res.error or res.status ~= 200 then
			fetch_error = res.error or `HTTP {res.status}`
			return
		end
		local ok, parsed = pcall(tern.json.decode, res.body)
		if not ok or type(parsed) ~= "table" or type(parsed.rules) ~= "table" then
			fetch_error = "rules.json does not parse: " .. tostring(parsed)
			return
		end
		fetch_error = nil
		if tern.json.encode(parsed) ~= tern.json.encode(doc) then
			doc = parsed
			tern.kv.set("doc", parsed)
			if later then
				apply(later)
			end
		end
	end)
end

local function on_change(cx)
	apply(cx)
	refresh(cx, false)
end

tern.on("window_start", function(cx)
	on_change(cx)
	if not tern.kv.get("url") then
		cx:toast("info", "Theme rules: no rules URL yet", "Palette › Theme rules: set rules URL")
	end
end)
tern.on("focus", function(_ev, cx)
	on_change(cx)
end)

-- omp starting or ending in the focused pane changes the profile without a focus change.
local function on_command(ev, cx)
	if ev.pane == cx.session:focused() then
		on_change(cx)
	end
end
tern.on("command_started", on_command)
tern.on("command_finished", on_command)

tern.command({
	id = "why",
	title = "Theme rules: why this theme",
	run = function(cx)
		local ctx, i, rule = apply(cx)
		local here = `host {ctx.host} · session {ctx.session} · profile {ctx.profile or "(no omp)"}`
		local verdict = if rule then `rule {i} → {rule.theme or "-"} / {rule.light or "-"}` else "no rule matches"
		cx:toast(if fetch_error then "error" else "info", `{verdict}`, here .. (if fetch_error then ` · rules: {fetch_error}` else ""))
		refresh(cx, true)
	end,
})

tern.command({
	id = "url",
	title = "Theme rules: set rules URL",
	run = function(cx)
		cx:prompt({ value = tern.kv.get("url"), placeholder = "http://server:8080/tern-theme/rules.json", action = "fetch" })
			:next(function(url, _err, later)
				if url and url ~= "" and later then
					tern.kv.set("url", url)
					fetched_at = -math.huge
					refresh(later, true)
				end
			end)
	end,
})

const cache = new Map<string, string>();

/** `repo` or `repo/rel`, cached per cwd. Falls back to the directory basename. */
export async function projectLabel(cwd: string): Promise<string> {
	const hit = cache.get(cwd);
	if (hit) return hit;
	const label = await resolveProjectLabel(cwd);
	cache.set(cwd, label);
	return label;
}

async function resolveProjectLabel(cwd: string): Promise<string> {
	const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
	if (code !== 0) return cwd.split("/").pop() || cwd;
	const root = out.trim();
	if (!root) return cwd.split("/").pop() || cwd;
	const repo = root.split("/").pop() || root;
	if (cwd === root) return repo;
	const rel = cwd.startsWith(`${root}/`) ? cwd.slice(root.length + 1) : "";
	return rel ? `${repo}/${rel}` : repo;
}

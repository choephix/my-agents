import { useSettings, type PluginClientContext, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { Pressable, Text, TextInput, View, type ViewStyle } from "react-native";
import {
  compilePreset, preferences, presetIdSchema, presetsSchema, projectName, projectOnlyRule, ruleTypes, ruleValueError,
  type Project, type RuleType,
} from "../shared/presets";
import { useProjects } from "./data";

type Colors = PluginSurfaceProps["theme"]["colors"];

const ruleCopy: Record<RuleType, { label: string; placeholder: string }> = {
  folderPrefix: { label: "Inside folder", placeholder: "/home/me/workspace/client" },
  folderName: { label: "Path has a folder named", placeholder: "acme  or  acme-*" },
  remoteGlob: { label: "Git remote", placeholder: "my-org/*" },
  pathGlob: { label: "Path pattern", placeholder: "/home/*/workspace/acme-*" },
  pathRegex: { label: "Path regex", placeholder: "/acme(-[^/]*)?$" },
};
const otherCollapsedCount = 5;

interface DraftRule { key: number; type: RuleType; value: string }
// `id` is set for saved presets and stays fixed so the sidebar selection survives renames.
// New presets get an id derived from their name when the draft is built.
interface DraftPreset { key: number; id?: string; name: string; rules: DraftRule[] }

let lastKey = 0;
const nextKey = () => ++lastKey;

function toDraft(presets: readonly { id?: string; name: string; rules: readonly { type: RuleType; value: string }[] }[]): DraftPreset[] {
  return presets.map((preset) => ({
    key: nextKey(), id: preset.id, name: preset.name,
    rules: preset.rules.map((rule) => ({ key: nextKey(), type: rule.type, value: rule.value })),
  }));
}

function slug(name: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(base) ? base : `preset${base ? `-${base}` : ""}`;
}

function buildPresets(draft: DraftPreset[]) {
  const taken = new Set(draft.flatMap((preset) => preset.id ? [preset.id] : []));
  return draft.map((preset) => {
    let id = preset.id;
    if (!id) {
      const base = slug(preset.name);
      id = base;
      for (let n = 2; taken.has(id) || !presetIdSchema.safeParse(id).success; n++) id = `${base}-${n}`;
      taken.add(id);
    }
    return { id, name: preset.name, rules: preset.rules.map(({ type, value }) => ({ type, value })) };
  });
}

// Accepts any JSON with the preset shape, so the form can show what is still wrong with its values.
const looseSchema = z.array(z.object({
  id: z.string().optional(),
  name: z.string(),
  rules: z.array(z.object({ type: z.enum(ruleTypes), value: z.string() })),
}));

function homeRelative(path: string): string {
  return path.replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, "~");
}

export function createPresetSettings(client: PluginClientContext) {
  return function PresetSettings({ theme, host }: PluginSurfaceProps) {
    const colors = theme.colors;
    const settings = useSettings(preferences);
    const projects = useProjects(client, host.id);
    const projectList = projects.data;

    const [draft, setDraft] = useState<{ presets: DraftPreset[]; revision: string } | null>(null);
    const [json, setJson] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [focusKey, setFocusKey] = useState<number | null>(null);
    // Set after a save while edits were typed during it: those edits stay and continue from the host's new revision.
    const savedFrom = useRef<string | null>(null);
    useEffect(() => {
      if (settings.status !== "ready") return;
      if (draft === null) {
        savedFrom.current = null;
        setDraft({ presets: toDraft(settings.values.presets), revision: settings.revision });
      } else if (savedFrom.current !== null && settings.revision !== savedFrom.current) {
        const revision = settings.revision;
        savedFrom.current = null;
        setDraft((current) => current && { ...current, revision });
      }
    }, [settings, draft]);

    const saved = settings.status === "ready" ? settings.values.presets : undefined;
    const presets = draft?.presets ?? [];
    const built = useMemo(() => buildPresets(presets), [presets]);
    const savedMatchers = useMemo(() => new Map((saved ?? []).map((preset) => [preset.id, compilePreset(preset)])), [saved]);
    // Invalid rules are skipped so the preview keeps working while a value is half typed.
    const preview = useMemo(() => presets.map((preset, index) => {
      const matches = compilePreset({ rules: preset.rules.filter((rule) => !ruleValueError(rule.type, rule.value)) });
      const savedMatches = savedMatchers.get(built[index].id);
      const matched = (projectList ?? []).filter(matches);
      return { matches, matched, added: new Set(matched.filter((project) => !savedMatches?.(project)).map((p) => p.projectId)) };
    }), [presets, built, savedMatchers, projectList]);
    const other = useMemo(() => (projectList ?? []).filter((project) => !preview.some(({ matches }) => matches(project))), [projectList, preview]);

    const problems = presets.reduce((count, preset) => count + (preset.name.trim() ? 0 : 1) + (preset.rules.length ? 0 : 1)
      + preset.rules.filter((rule) => ruleValueError(rule.type, rule.value)).length, 0);
    const parsed = presetsSchema.safeParse(built);
    const valid = problems === 0 && parsed.success;
    const dirty = json !== null || JSON.stringify(built) !== JSON.stringify(saved ?? []);

    function update(change: (presets: DraftPreset[]) => DraftPreset[]) {
      setDraft((current) => current && { ...current, presets: change(current.presets) });
      setError("");
    }
    function updatePreset(key: number, change: (preset: DraftPreset) => DraftPreset) {
      update((list) => list.map((preset) => preset.key === key ? change(preset) : preset));
    }
    function addPreset(name: string, rule: Omit<DraftRule, "key">) {
      const key = nextKey();
      update((list) => [...list, { key, name, rules: [{ key: nextKey(), ...rule }] }]);
      setFocusKey(key);
    }
    async function save() {
      if (!draft) return;
      let values;
      try {
        const result = json === null ? parsed : presetsSchema.safeParse(JSON.parse(json));
        if (!result.success) throw new Error(result.error.issues.map((issue) => `${issue.path.join(".") || "presets"}: ${issue.message}`).join("\n"));
        values = result.data;
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
      setError("");
      const sent = draft;
      if (await settings.save({ presets: values }, draft.revision)) {
        savedFrom.current = sent.revision;
        setJson(null);
        setDraft((current) => current === sent ? null : current);
      }
    }
    async function discard() {
      // Reset at once from the values on screen; the reload (a host round trip) then picks up changes made elsewhere,
      // unless the user has started editing again meanwhile.
      const fresh = settings.status === "ready" ? { presets: toDraft(settings.values.presets), revision: settings.revision } : null;
      setDraft(fresh); setJson(null); setError("");
      await settings.reload();
      setDraft((current) => current === fresh ? null : current);
    }
    function toggleJson() {
      if (json === null) { setJson(JSON.stringify(built, null, 2)); setError(""); return; }
      try { const presets = toDraft(looseSchema.parse(JSON.parse(json))); setDraft((current) => current && { ...current, presets }); setJson(null); setError(""); }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    }

    const statusText = error || settings.saveError
      || (settings.status === "error" || settings.status === "invalid" ? settings.error : "")
      || (settings.saving ? "Saving…" : json === null && problems ? `Fix ${problems === 1 ? "1 problem" : `${problems} problems`} to save` : "");
    const canSave = !!draft && dirty && !settings.saving && (json !== null || valid);

    return <View style={{ gap: 14, paddingVertical: 16 }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>
        Each preset becomes a sidebar button. Any matching rule includes a project. The lists update as you type; nothing changes until you save.
      </Text>
      {settings.status === "loading" && <Text style={{ color: colors.foregroundMuted }}>Loading…</Text>}
      {draft && json !== null && <TextInput testID="noice-filter-presets-json" accessibilityLabel="Preset definitions JSON" multiline value={json}
        onChangeText={(text) => { setJson(text); setError(""); }} autoCapitalize="none" autoCorrect={false}
        style={{ minHeight: 320, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, color: colors.foreground, backgroundColor: colors.surface1, fontFamily: "monospace", fontSize: 12.5, textAlignVertical: "top" }} />}
      {draft && json === null && <>
        {presets.map((preset, index) => <PresetCard key={preset.key} colors={colors} preset={preset} preview={preview[index]}
          projectsState={projects.isError && !projectList ? "error" : projectList ? "ready" : "loading"} autoFocus={focusKey === preset.key}
          onChange={(change) => updatePreset(preset.key, change)}
          onDelete={() => update((list) => list.filter(({ key }) => key !== preset.key))} />)}
        <Pressable accessibilityRole="button" testID="noice-filter-presets-add-preset" onPress={() => addPreset("", { type: "folderName", value: "" })}
          style={(state) => ({ ...card(colors), borderStyle: "dashed", borderColor: colors.surface2, backgroundColor: "transparent", paddingHorizontal: 16, paddingVertical: 11, opacity: hovered(state) ? 1 : 0.85 })}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>+ Add preset</Text>
        </Pressable>
        <OtherCard colors={colors} projects={other} allProjects={projectList ?? []} loaded={!!projectList} presets={presets}
          onAdd={(preset, rule) => updatePreset(preset.key, (current) => ({ ...current, rules: [...current.rules, { key: nextKey(), ...rule }] }))}
          onNewPreset={(project, rule) => addPreset(projectName(project), rule)} />
      </>}
      {statusText ? <Text accessibilityLiveRegion="polite" style={{ color: error || settings.saveError || settings.status !== "ready" ? colors.statusDanger : colors.foregroundMuted, fontSize: 12.5 }}>{statusText}</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Pressable accessibilityRole="button" testID="noice-filter-presets-save" accessibilityLabel="Save preset definitions" disabled={!canSave} onPress={() => void save()}
          style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 6, backgroundColor: colors.accent, opacity: canSave ? 1 : 0.4 }}>
          <Text style={{ color: colors.accentForeground, fontSize: 13, fontWeight: "500" }}>Save</Text>
        </Pressable>
        <LinkButton colors={colors} testID="noice-filter-presets-discard" disabled={!dirty} onPress={() => void discard()}>Discard changes</LinkButton>
        <View style={{ flex: 1 }} />
        {json !== null && <LinkButton colors={colors} onPress={async () => { if (await settings.reset()) { setDraft(null); setJson(null); setError(""); } }}>Reset to defaults</LinkButton>}
        {settings.status === "invalid" && <LinkButton colors={colors} onPress={async () => { if (await settings.reset()) { setDraft(null); setError(""); } }}>Reset to defaults</LinkButton>}
        {draft && <LinkButton colors={colors} testID="noice-filter-presets-json-toggle" accent onPress={toggleJson}>{json === null ? "Edit as JSON" : "Edit with form"}</LinkButton>}
      </View>
    </View>;
  };
}

// react-native-web understands position: fixed; React Native's types only know absolute.
const backdropStyle = { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, cursor: "default" } as unknown as ViewStyle;

function hovered(state: object): boolean {
  // react-native-web adds `hovered` to the pressable state; native never sets it.
  return "hovered" in state && state.hovered === true;
}

function card(colors: Colors): ViewStyle {
  return { borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface1 };
}

function LinkButton({ colors, children, onPress, disabled, accent, testID }: {
  colors: Colors; children: ReactNode; onPress(): void; disabled?: boolean; accent?: boolean; testID?: string;
}) {
  return <Pressable accessibilityRole="button" testID={testID} disabled={disabled} onPress={onPress} style={{ paddingHorizontal: 8, paddingVertical: 7, opacity: disabled ? 0.45 : 1 }}>
    {(state) => <Text style={{ fontSize: 13, color: accent ? colors.accent : hovered(state) ? colors.foreground : colors.foregroundMuted }}>{children}</Text>}
  </Pressable>;
}

function IconButton({ colors, name, label, onPress, testID }: { colors: Colors; name: string; label: string; onPress(): void; testID?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={onPress} hitSlop={6}
    style={{ width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 5 }}>
    {(state) => <Icon name={name} size={14} color={hovered(state) ? colors.foreground : colors.foregroundMuted} />}
  </Pressable>;
}

function FieldError({ colors, children }: { colors: Colors; children?: string }) {
  return children ? <Text style={{ color: colors.statusDanger, fontSize: 12, marginTop: 3 }}>{children}</Text> : null;
}

function RuleTypeSelect({ colors, value, onChange, label }: { colors: Colors; value: RuleType; onChange(type: RuleType): void; label: string }) {
  // A native <select> (web only, like the rest of this plugin): keyboard and screen reader support, never clipped by the card.
  return <select aria-label={label} value={value} onChange={(event) => {
    // Without the DOM lib HTMLSelectElement is an empty interface; the select only offers rule types.
    const select = event.currentTarget as unknown as { value: RuleType };
    onChange(select.value);
  }}
    style={{
      width: 196, height: 32, flexShrink: 0, padding: "0 8px", borderRadius: 6, border: `1px solid ${colors.border}`,
      backgroundColor: colors.surface0, color: colors.foreground, fontSize: 13, fontFamily: "inherit", cursor: "pointer",
    }}>
    {ruleTypes.map((type) => <option key={type} value={type} style={{ backgroundColor: colors.surface1, color: colors.foreground }}>{ruleCopy[type].label}</option>)}
  </select>;
}

function PresetCard({ colors, preset, preview, projectsState, autoFocus, onChange, onDelete }: {
  colors: Colors;
  preset: DraftPreset;
  preview: { matched: Project[]; added: Set<string> };
  projectsState: "loading" | "ready" | "error";
  autoFocus: boolean;
  onChange(change: (preset: DraftPreset) => DraftPreset): void;
  onDelete(): void;
}) {
  const label = preset.name.trim() || "new preset";
  const nameError = preset.name.trim() ? undefined : "Enter a name";
  function setRule(key: number, change: Partial<DraftRule>) {
    onChange((current) => ({ ...current, rules: current.rules.map((rule) => rule.key === key ? { ...rule, ...change } : rule) }));
  }
  return <View testID={`noice-filter-presets-card-${preset.id ?? "new"}`} style={card(colors)}>
    <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent }} />
        <TextInput accessibilityLabel="Preset name" value={preset.name} placeholder="Preset name" placeholderTextColor={colors.foregroundMuted}
          autoFocus={autoFocus} onChangeText={(name) => onChange((current) => ({ ...current, name }))}
          style={{ flex: 1, color: colors.foreground, fontSize: 15, fontWeight: "600", paddingVertical: 4, paddingHorizontal: 6, marginLeft: -6, borderRadius: 5, borderWidth: 1, borderColor: nameError ? colors.statusDanger : "transparent" }} />
        <IconButton colors={colors} name="Trash2" label={`Delete preset ${label}`} onPress={onDelete} />
      </View>
      <View style={{ marginLeft: 17 }}><FieldError colors={colors}>{nameError}</FieldError></View>
    </View>
    <View style={{ borderTopWidth: 1, borderTopColor: colors.surface0, paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
      {preset.rules.map((rule, index) => {
        const ruleError = ruleValueError(rule.type, rule.value);
        return <View key={rule.key} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <Text style={{ width: 18, lineHeight: 32, fontSize: 12, color: colors.foregroundMuted, textAlign: "right" }}>{index ? "or" : ""}</Text>
          <RuleTypeSelect colors={colors} label={`Rule ${index + 1} type`} value={rule.type} onChange={(type) => setRule(rule.key, { type })} />
          <View style={{ flex: 1 }}>
            <TextInput accessibilityLabel={`Rule ${index + 1} value`} value={rule.value} placeholder={`e.g. ${ruleCopy[rule.type].placeholder}`}
              placeholderTextColor={colors.foregroundMuted} autoCapitalize="none" autoCorrect={false}
              onChangeText={(value) => setRule(rule.key, { value })}
              style={{
                height: 32, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: ruleError ? colors.statusDanger : colors.border,
                backgroundColor: colors.surface0, color: colors.foreground, fontFamily: "monospace", fontSize: 12.5,
              }} />
            <FieldError colors={colors}>{ruleError}</FieldError>
          </View>
          <View style={{ height: 32, justifyContent: "center" }}>
            <IconButton colors={colors} name="X" label={`Remove rule ${index + 1}`}
              onPress={() => onChange((current) => ({ ...current, rules: current.rules.filter(({ key }) => key !== rule.key) }))} />
          </View>
        </View>;
      })}
      {preset.rules.length === 0 && <FieldError colors={colors}>Add at least one rule</FieldError>}
      <Pressable accessibilityRole="button" accessibilityLabel={`Add rule to ${label}`} style={{ alignSelf: "flex-start", marginLeft: 26, paddingVertical: 4 }}
        onPress={() => onChange((current) => ({ ...current, rules: [...current.rules, { key: nextKey(), type: current.rules.at(-1)?.type ?? "folderName", value: "" }] }))}>
        {(state) => <Text style={{ fontSize: 13, color: hovered(state) ? colors.foreground : colors.foregroundMuted }}>+ Add rule</Text>}
      </Pressable>
    </View>
    <View style={{ borderTopWidth: 1, borderTopColor: colors.surface0, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, gap: 8 }}>
      <Text testID="noice-filter-presets-match-count" style={{ fontSize: 12, color: colors.foregroundMuted }}>
        {projectsState === "error" ? "Projects unavailable" : projectsState === "loading" ? "Loading projects…"
          : preview.matched.length ? `Matches ${preview.matched.length === 1 ? "1 project" : `${preview.matched.length} projects`}` : "Matches no projects"}
      </Text>
      {preview.matched.length > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {preview.matched.map((project) => {
          const added = preview.added.has(project.projectId);
          const name = projectName(project);
          return <View key={project.projectId} accessibilityLabel={added ? `${name}, newly matched` : name}
            style={{ paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: added ? colors.statusSuccess : colors.border, backgroundColor: added ? "transparent" : colors.surface2 }}>
            <Text style={{ fontSize: 12, color: added ? colors.statusSuccess : colors.foreground }}>{added ? `+ ${name}` : name}</Text>
          </View>;
        })}
      </View>}
    </View>
  </View>;
}

type AddedRule = Omit<DraftRule, "key">;

function OtherCard({ colors, projects, allProjects, loaded, presets, onAdd, onNewPreset }: {
  colors: Colors;
  projects: Project[];
  allProjects: Project[];
  loaded: boolean;
  presets: DraftPreset[];
  onAdd(preset: DraftPreset, rule: AddedRule): void;
  onNewPreset(project: Project, rule: AddedRule): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const shown = expanded ? projects : projects.slice(0, otherCollapsedCount);
  const hiddenCount = projects.length - shown.length;
  return <View testID="noice-filter-presets-other" style={{ ...card(colors), zIndex: menu ? 10 : 0 }}>
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 }}>
      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>Other</Text>
      <Text style={{ flex: 1, fontSize: 12, color: colors.foregroundMuted }}>
        {!loaded ? "Loading projects…" : projects.length ? `${projects.length === 1 ? "1 project" : `${projects.length} projects`} no preset matches · automatic` : "Every project matches a preset"}
      </Text>
    </View>
    {shown.map((project) => {
      const open = menu === project.projectId;
      const name = projectName(project);
      return <View key={project.projectId} style={{ zIndex: open ? 10 : 0, flexDirection: "row", alignItems: "center", gap: 12, minHeight: 40, paddingLeft: 16, paddingRight: 10, borderTopWidth: 1, borderTopColor: colors.surface0, backgroundColor: open ? colors.surface2 : "transparent" }}>
        <Text numberOfLines={1} style={{ width: 210, fontSize: 13, color: colors.foreground }}>{name}</Text>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, fontFamily: "monospace", color: colors.foregroundMuted }}>{homeRelative(project.projectRootPath)}</Text>
        <View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Add ${name} to a preset`} accessibilityState={{ expanded: open }}
            testID={`noice-filter-presets-add-to-${project.projectId}`} onPress={() => setMenu(open ? null : project.projectId)}
            style={(state) => ({ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5, borderWidth: 1, borderColor: open || hovered(state) ? colors.border : "transparent" })}>
            {(state) => <>
              <Text style={{ fontSize: 12, color: open || hovered(state) ? colors.foreground : colors.foregroundMuted }}>Add to</Text>
              <Icon name="ChevronDown" size={12} color={open || hovered(state) ? colors.foreground : colors.foregroundMuted} />
            </>}
          </Pressable>
          {open && (() => {
            const rule = projectOnlyRule(project, allProjects);
            const detail = `${ruleCopy[rule.type].label} ${homeRelative(rule.value)}`;
            return <>
              <Pressable accessibilityLabel="Close menu" onPress={() => setMenu(null)}
                style={backdropStyle} />
              <View accessibilityRole="menu" style={{
                position: "absolute", right: 0, top: 32, width: 340, padding: 5, gap: 2, borderRadius: 8,
                borderWidth: 1, borderColor: colors.surface2, backgroundColor: colors.surface1,
                shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
              }}>
                {presets.map((preset) => <MenuItem key={preset.key} colors={colors}
                  title={`${preset.name.trim() || "New preset"}: this project only`} detail={detail}
                  onPress={() => { setMenu(null); onAdd(preset, rule); }} />)}
                <MenuItem colors={colors} title="New preset…" detail={presets.length ? undefined : detail}
                  onPress={() => { setMenu(null); onNewPreset(project, rule); }} />
              </View>
            </>;
          })()}
        </View>
      </View>;
    })}
    {projects.length > otherCollapsedCount && <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)}
      style={{ paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.surface0 }}>
      {(state) => <Text style={{ fontSize: 13, color: hovered(state) ? colors.foreground : colors.foregroundMuted }}>{expanded ? "Show less" : `+ ${hiddenCount} more`}</Text>}
    </Pressable>}
  </View>;
}

function MenuItem({ colors, title, detail, onPress }: { colors: Colors; title: string; detail?: string; onPress(): void }) {
  return <Pressable accessibilityRole="menuitem" onPress={onPress}
    style={(state) => ({ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 6, backgroundColor: hovered(state) || ("focused" in state && state.focused === true) ? colors.surface2 : "transparent" })}>
    <Text style={{ fontSize: 13, color: colors.foreground }}>{title}</Text>
    {detail && <Text numberOfLines={1} style={{ fontSize: 11.5, fontFamily: "monospace", color: colors.foregroundMuted, marginTop: 1 }}>{detail}</Text>}
  </Pressable>;
}

import { useEffect, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { usePaseo, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { preferences, type Preferences } from "../shared/preferences";
import { putMapping, type IconStyle, type Mapping } from "../shared/images";
import { providerRows, type ProviderEntry } from "../shared/rows";
import { pickImage } from "./web";

type Theme = PluginSurfaceProps["theme"];
type Providers = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; entries: ProviderEntry[] };

/** `seeProviders` hands each fresh provider list to the repainter, so providers added since start resolve. */
export function createSettingsScreen(apply: (values: Preferences, host: string) => void, seeProviders: (entries: ProviderEntry[]) => void) {
  return function ProviderIconsSettings({ theme, host, layout }: PluginSurfaceProps) {
    const settings = useSettings(preferences);
    const paseo = usePaseo();
    const [providers, setProviders] = useState<Providers>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);
    const [busy, setBusy] = useState<string | null>(null);
    // Picker errors carry a message; failed saves show the host's `saveError` on the row that saved.
    const [failure, setFailure] = useState<{ provider: string; message?: string } | null>(null);
    const muted = { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 18 };
    const canPick = layout.platform === "web";

    useEffect(() => {
      let disposed = false;
      setProviders({ status: "loading" });
      paseo.providers.snapshot().then(
        (result) => {
          const entries = result.entries.map((entry) => ({ id: entry.provider, label: entry.label ?? entry.provider }));
          seeProviders(entries);
          if (!disposed) setProviders({ status: "ready", entries });
        },
        (reason) => { if (!disposed) setProviders({ status: "error", error: reason instanceof Error ? reason.message : String(reason) }); },
      );
      return () => { disposed = true; };
    }, [paseo, attempt]);
    useEffect(() => {
      if (settings.status === "ready") apply(settings.values, host.id);
    }, [settings.status, settings.status === "ready" ? settings.values : null, host.id]);

    if (settings.status === "loading") return <SettingsSection title="Provider icons"><Text style={muted}>Loading…</Text></SettingsSection>;
    if (settings.status !== "ready") {
      return <SettingsSection title="Provider icons">
        <SettingsCard>
          <SettingsRow label="Saved icons could not be read" error={settings.error} />
          <SettingsAction label="Try again" actionLabel="Reload" onPress={() => { void settings.reload(); }} />
          {settings.status === "invalid" ? <SettingsAction label="Discard saved icons" hint="Restores Paseo's default icons for every provider." actionLabel="Reset" onPress={() => { void settings.reset(); }} /> : null}
        </SettingsCard>
      </SettingsSection>;
    }

    const { values, revision } = settings;
    const locked = busy !== null || settings.saving;
    async function save(provider: string, mappings: Mapping[]) {
      if (!await settings.save({ hostId: host.id, mappings }, revision)) setFailure({ provider });
    }
    async function choose(provider: string, style: IconStyle) {
      setFailure(null);
      setBusy(provider);
      try {
        const picked = await pickImage();
        if (picked) await save(provider, putMapping(values.mappings, { provider, style, ...picked }));
      } catch (reason) {
        setFailure({ provider, message: reason instanceof Error ? reason.message : String(reason) });
      } finally { setBusy(null); }
    }
    const rows = providers.status === "ready" ? providerRows(providers.entries, values.mappings) : [];

    return <SettingsSection title="Provider icons">
      <Text style={muted}>
        {canPick
          ? "Replace the glyph Paseo draws for a provider. Icons are saved on this host and used by every web and desktop window connected to it. Native phone apps keep Paseo's icons."
          : "Icons are picked in the web or desktop app; native phone apps always show Paseo's own icons."}
      </Text>
      <SettingsCard testID="noice-provider-icons-list">
        {providers.status === "loading" ? <SettingsRow label="Loading providers…" /> : null}
        {providers.status === "error"
          ? <SettingsAction label="Could not load providers" hint={providers.error} actionLabel="Retry" onPress={() => setAttempt((n) => n + 1)} />
          : null}
        {rows.map((row) => {
          const mapping = row.mapping;
          const detail = row.label === row.id ? "" : `${row.id} · `;
          const hint = !row.configured ? `Not configured on this host · ${mapping?.name}`
            : mapping ? `${detail}${mapping.name}` : `${detail}Paseo default`;
          return <SettingsRow key={row.id} testID={`noice-provider-icons-row-${row.id}`} label={row.label} hint={hint}
            error={failure?.provider === row.id ? failure.message ?? settings.saveError ?? "Not saved." : null}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {mapping ? <>
                <Preview mapping={mapping} theme={theme} />
                <Segmented theme={theme} label={`${row.label} icon colors`} disabled={locked} value={mapping.style}
                  options={[{ value: "original", label: "Color" }, { value: "monochrome", label: "Mono" }]}
                  onChange={(style) => { setFailure(null); void save(row.id, putMapping(values.mappings, { ...mapping, style })); }} />
              </> : null}
              {row.configured ? <Button theme={theme} disabled={locked || !canPick} accessibilityLabel={`${mapping ? "Replace" : "Choose"} icon for ${row.label}`}
                label={busy === row.id ? "Choosing…" : mapping ? "Replace…" : "Choose…"}
                onPress={() => { void choose(row.id, mapping?.style ?? "original"); }} /> : null}
              {mapping ? <Button theme={theme} disabled={locked} accessibilityLabel={`Remove custom icon for ${row.label}`} label="Remove"
                onPress={() => { setFailure(null); void save(row.id, values.mappings.filter((entry) => entry.provider !== row.id)); }} /> : null}
            </View>
          </SettingsRow>;
        })}
      </SettingsCard>
      <Text style={muted}>
        SVG, PNG, WebP or JPEG up to 128 KiB. Icons render at 14–16 px, so use a square mark with little padding.
        Color keeps the image as drawn; Mono paints its opaque pixels in Paseo's glyph color, so a transparent-background mark matches the theme.
      </Text>
    </SettingsSection>;
  };
}

/** The icon at its real 16 px size on the current theme and on the opposite one. */
function Preview({ mapping, theme }: { mapping: Mapping; theme: Theme }) {
  const swatches = [
    { name: "current", background: theme.colors.surface1, ink: theme.colors.foregroundMuted },
    { name: "opposite", background: theme.colors.foreground, ink: theme.colors.surface1 },
  ];
  return <View style={{ flexDirection: "row", gap: 4 }}>
    {swatches.map((swatch) => <View key={swatch.name} accessibilityLabel={`Preview on the ${swatch.name} theme`}
      style={{ width: 28, height: 28, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: swatch.background, alignItems: "center", justifyContent: "center" }}>
      <Image source={{ uri: mapping.image }} resizeMode="contain"
        style={{ width: 16, height: 16, ...(mapping.style === "monochrome" ? { tintColor: swatch.ink } : null) }} />
    </View>)}
  </View>;
}

function Button({ theme, label, accessibilityLabel, disabled, onPress }: { theme: Theme; label: string; accessibilityLabel: string; disabled?: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress}
    // react-native-web adds `hovered` to the pressable state; native platforms never set it.
    style={(state) => ({
      borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, paddingHorizontal: 10, height: 28, justifyContent: "center",
      backgroundColor: theme.colors.surface2, opacity: disabled ? 0.5 : "hovered" in state && state.hovered ? 0.8 : 1,
    })}>
    <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{label}</Text>
  </Pressable>;
}

function Segmented<Value extends string>({ theme, label, value, options, disabled, onChange }: {
  theme: Theme; label: string; value: Value; options: readonly { value: Value; label: string }[]; disabled?: boolean; onChange(value: Value): void;
}) {
  return <View accessibilityRole="radiogroup" accessibilityLabel={label}
    style={{ flexDirection: "row", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, height: 28, padding: 2, opacity: disabled ? 0.5 : 1 }}>
    {options.map((option) => {
      const active = option.value === value;
      return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: active, disabled }} disabled={disabled || active}
        onPress={() => onChange(option.value)}
        style={{ paddingHorizontal: 8, borderRadius: 4, justifyContent: "center", backgroundColor: active ? theme.colors.surface2 : "transparent" }}>
        <Text style={{ color: active ? theme.colors.foreground : theme.colors.foregroundMuted, fontSize: 12 }}>{option.label}</Text>
      </Pressable>;
    })}
  </View>;
}

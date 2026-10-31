// filter-presets-loading demo data: the presets of noice-filter-presets, each
// with the projects it matches. `node tools/mock-data.mjs demo/filter-presets-loading`
// writes data.acme.json and data.live.json from this.
import { join } from "node:path";

export const acme = {
  presets: [
    { id: "work", name: "Work", projects: ["postgres", "kubernetes", "figma-lite"] },
    { id: "home", name: "Home", projects: ["homestead", "adulting"] },
  ],
};

// Live: Stefan's saved presets, matched against the live projects by the plugin's own matcher.
export async function live(data, { paseoHome, readJson }) {
  const { compilePreset } = await import("../../../paseo-plugins/noice-filter-presets/shared/presets.ts");
  const saved = readJson(join(paseoHome, "plugin-settings/noice-filter-presets/presets.json")).values.presets;
  const stored = new Map(readJson(join(paseoHome, "projects/projects.json")).map((p) => [p.projectId, p]));
  const projects = Object.keys(data.projects).flatMap((id) => {
    const p = stored.get(id);
    return p ? [{ projectId: id, projectKey: p.projectKey, projectRootPath: p.rootPath, projectDisplayName: p.displayName, projectCustomName: p.customName }] : [];
  });
  return {
    presets: saved.map((preset) => {
      const matches = compilePreset(preset);
      return { id: preset.id, name: preset.name, projects: projects.filter(matches).map((p) => p.projectId) };
    }),
  };
}

import type { PluginClientContext } from "@getpaseo/plugin/client";

// One self-contained block per theme: delete a block to remove that theme.
// Sources and the reasoning behind each token are in OVERVIEW.md.
const themes = [
  // T3 Chat Dark
  {
    id: "t3-chat-dark",
    name: "T3 Chat Dark",
    appearance: "dark",
    colors: {
      background: "#1f1a24",
      foreground: "#f9f8fb",
      raised: "#2c2631",
      control: "#362d3d",
      border: "#27242c",
      accent: "#fbd0e8",
      mutedForeground: "#e7d0dd",
      ring: "#968d9f",
    },
  },
  // T3 Chat Light
  {
    id: "t3-chat-light",
    name: "T3 Chat Light",
    appearance: "light",
    colors: {
      background: "#fdf7fd",
      foreground: "#501854",
      raised: "#fdfafd",
      control: "#f2e1f4",
      border: "#eee1ed",
      accent: "#c12269",
      mutedForeground: "#ac1668",
      ring: "#eaa7cb",
    },
  },
  // Tokyo Night
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    appearance: "dark",
    colors: {
      background: "#1a1b26",
      foreground: "#c0caf5",
      raised: "#16161e",
      control: "#292e42",
      border: "#3b4261",
      accent: "#7aa2f7",
      mutedForeground: "#a9b1d6",
      ring: "#737aa2",
    },
  },
  // Dracula
  {
    id: "dracula",
    name: "Dracula",
    appearance: "dark",
    colors: {
      background: "#282a36",
      foreground: "#f8f8f2",
      raised: "#21222c",
      control: "#343746",
      border: "#424450",
      accent: "#bd93f9",
      mutedForeground: "#adb5cb", // derived: foreground/comment 50/50
      ring: "#6272a4",
    },
  },
  // Rosé Pine
  {
    id: "rose-pine",
    name: "Rosé Pine",
    appearance: "dark",
    colors: {
      background: "#191724",
      foreground: "#e0def4",
      raised: "#1f1d2e",
      control: "#26233a",
      border: "#403d52",
      accent: "#c4a7e7",
      mutedForeground: "#908caa",
      ring: "#6e6a86",
    },
  },
  // Nord
  {
    id: "nord",
    name: "Nord",
    appearance: "dark",
    colors: {
      background: "#2e3440",
      foreground: "#eceff4",
      raised: "#3b4252",
      control: "#434c5e",
      border: "#4c566a",
      accent: "#88c0d0",
      mutedForeground: "#d8dee9",
      ring: "#767f90", // derived: nord3 70% + nord4 30%
    },
  },
  // Gruvbox Dark
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    appearance: "dark",
    colors: {
      background: "#282828",
      foreground: "#ebdbb2",
      raised: "#32302f",
      control: "#3c3836",
      border: "#504945",
      accent: "#8ec07c",
      mutedForeground: "#bdae93",
      ring: "#928374",
    },
  },
  // One Dark
  {
    id: "one-dark",
    name: "One Dark",
    appearance: "dark",
    colors: {
      background: "#282c34",
      foreground: "#d7dae0",
      raised: "#21252b",
      control: "#3a3f4b",
      border: "#4b5263",
      accent: "#61afef",
      mutedForeground: "#abb2bf",
      ring: "#7f848e",
    },
  },
  // One Light
  {
    id: "one-light",
    name: "One Light",
    appearance: "light",
    colors: {
      background: "#fafafa",
      foreground: "#383a42",
      raised: "#f0f0f1",
      control: "#eaeaeb",
      border: "#dbdbdc",
      accent: "#4078f2",
      mutedForeground: "#696c77",
      ring: "#acacae", // derived: One Light UI grey darkened 16% toward mono-1
    },
  },
  // GitHub Dark
  {
    id: "github-dark",
    name: "GitHub Dark",
    appearance: "dark",
    colors: {
      background: "#0d1117",
      foreground: "#e6edf3",
      raised: "#161b22",
      control: "#21262d",
      border: "#30363d",
      accent: "#58a6ff",
      mutedForeground: "#8b949e",
      ring: "#6e7681",
    },
  },
  // GitHub Light
  {
    id: "github-light",
    name: "GitHub Light",
    appearance: "light",
    colors: {
      background: "#ffffff",
      foreground: "#1f2328",
      raised: "#f6f8fa",
      control: "#f6f8fa",
      border: "#d0d7de",
      accent: "#0969da",
      mutedForeground: "#59636e",
      ring: "#afb8c1",
    },
  },
  // Solarized Dark
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    appearance: "dark",
    colors: {
      background: "#002b36",
      foreground: "#93a1a1",
      raised: "#00212b",
      control: "#073642",
      border: "#234a54", // derived: base02 65% + base01 35%
      accent: "#268bd2",
      mutedForeground: "#839496",
      ring: "#586e75",
    },
  },
  // Solarized Light
  {
    id: "solarized-light",
    name: "Solarized Light",
    appearance: "light",
    colors: {
      background: "#fdf6e3",
      foreground: "#073642",
      raised: "#f5efdc",
      control: "#eee8d5",
      border: "#ddd6c1",
      accent: "#268bd2",
      mutedForeground: "#586e75",
      ring: "#9faaa6", // derived: base1 with a little base2 and base02
    },
  },
  // Kanagawa Wave
  {
    id: "kanagawa-wave",
    name: "Kanagawa Wave",
    appearance: "dark",
    colors: {
      background: "#1f1f28",
      foreground: "#dcd7ba",
      raised: "#16161d",
      control: "#2a2a37",
      border: "#363646",
      accent: "#7e9cd8",
      mutedForeground: "#c8c093",
      ring: "#727169",
    },
  },
  // Everforest Dark
  {
    id: "everforest-dark",
    name: "Everforest Dark",
    appearance: "dark",
    colors: {
      background: "#2d353b",
      foreground: "#d3c6aa",
      raised: "#343f44",
      control: "#3d484d",
      border: "#475258",
      accent: "#a7c080",
      mutedForeground: "#adb2a3", // derived: grey2 70% + fg 30%
      ring: "#7a8478",
    },
  },
] as const;

export default function contribute(client: PluginClientContext) {
  const removers = themes.map((theme) => client.addTheme(theme));
  return () => {
    for (const remove of removers) remove();
  };
}

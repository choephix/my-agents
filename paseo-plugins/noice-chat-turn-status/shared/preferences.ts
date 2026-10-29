import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Picker order: Off first, then the picks. "paseo-smooth" is Paseo's own dot grid, faded instead of stepped. */
export const SPINNERS = [
  "off", "paseo-smooth", "typing-dots", "typing-bubble", "jelly-dots", "words", "orbit", "twin-comets",
  "comet-arc", "binary-pair", "atom", "eclipse", "moon-phases", "morph", "starburst", "constellation",
  "bounce", "sideways-bounce", "hop-across", "cradle", "braille-trail", "snake", "triangle-hop",
  "sliding-tiles", "ripple-grid", "flip-tile",
] as const;
export const LIVE_STYLES = ["off", "shimmer", "rolling", "typed", "icon"] as const;
export const TIME_STYLES = ["off", "plain", "shimmer", "rolling", "warming"] as const;

export type SpinnerId = (typeof SPINNERS)[number];
export type LiveStyle = (typeof LIVE_STYLES)[number];
export type TimeStyle = (typeof TIME_STYLES)[number];

export const SPINNER_NAMES: Record<SpinnerId, string> = {
  off: "Off", "paseo-smooth": "Paseo, smooth", "typing-dots": "Typing dots", "typing-bubble": "Typing bubble",
  "jelly-dots": "Jelly dots", words: "Words", orbit: "Orbit", "twin-comets": "Twin comets", "comet-arc": "Comet arc",
  "binary-pair": "Binary pair", atom: "Atom", eclipse: "Eclipse", "moon-phases": "Moon phases", morph: "Morph",
  starburst: "Starburst", constellation: "Constellation", bounce: "Bounce", "sideways-bounce": "Sideways bounce",
  "hop-across": "Hop across", cradle: "Cradle", "braille-trail": "Braille trail", snake: "Snake",
  "triangle-hop": "Triangle hop", "sliding-tiles": "Sliding tiles", "ripple-grid": "Ripple grid", "flip-tile": "Flip tile",
};
export const LIVE_NAMES: Record<LiveStyle, string> = {
  off: "Off", shimmer: "Shimmer", rolling: "Rolling", typed: "Typed", icon: "Icon",
};
export const TIME_NAMES: Record<TimeStyle, string> = {
  off: "Off", plain: "Plain", shimmer: "Shimmer", rolling: "Rolling", warming: "Warming",
};

export const preferences = defineSettings({
  id: "indicator",
  scope: "host",
  version: 1,
  schema: z.object({
    spinner: z.enum(SPINNERS).default("paseo-smooth"),
    /** What the agent is doing right now, read from the newest tool row of the turn. */
    live: z.enum(LIVE_STYLES).default("off"),
    /** plain = Paseo's own time text; warming hides it for a minute, then fades in and turns amber/red. */
    time: z.enum(TIME_STYLES).default("shimmer"),
  }),
});
export type Preferences = z.output<typeof preferences.schema>;
export const DEFAULTS: Preferences = preferences.schema.parse({});

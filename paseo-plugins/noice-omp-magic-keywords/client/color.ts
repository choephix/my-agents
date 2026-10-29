// Keyword colours keep OMP's hue sweeps but not its HSL tones. Fully saturated HSL varies wildly in
// perceived lightness (yellow is bright, blue is dark), so some stops sank into the bubble. Each stop
// is drawn instead at one perceptual lightness and chroma in OKLCH, which keeps every hue at about
// 4:1 contrast or better against Paseo's message bubble (#434645 dark, #e4e4e7 light). The Preview
// in the settings uses React Native colours, so the result is an `rgb()` string rather than `oklch()`.

export type Tone = "dark" | "light";

/** OKLCH lightness and chroma per theme: light glyphs on a dark bubble, darker ones on a light bubble. */
const TONES: Record<Tone, { lightness: number; chroma: number }> = {
  dark: { lightness: 0.8, chroma: 0.17 },
  light: { lightness: 0.5, chroma: 0.17 },
};

type Rgb = [number, number, number];

/** The colour of OMP's gradient stop `hsl(hslHue 100% 50%)`, at the tone's lightness and chroma, as `rgb(r, g, b)`. */
export function keywordColor(hslHue: number, tone: Tone): string {
  const { lightness, chroma } = TONES[tone];
  const hue = oklabHue(hslStop(((hslHue % 360) + 360) % 360));
  // Linear sRGB at chroma `c`, or undefined outside the gamut (with slack for rounding in the matrices).
  const at = (c: number): Rgb | undefined => {
    const rgb = oklabToLinear(lightness, c * Math.cos(hue), c * Math.sin(hue));
    return rgb.every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4) ? rgb : undefined;
  };
  let rgb = at(chroma);
  if (!rgb) {
    // Bisect for the largest chroma sRGB can show at this lightness and hue; chroma 0 is grey, always in gamut.
    rgb = at(0)!;
    let low = 0;
    let high = chroma;
    for (let step = 0; step < 16; step++) {
      const mid = (low + high) / 2;
      const fit = at(mid);
      if (fit) {
        low = mid;
        rgb = fit;
      } else {
        high = mid;
      }
    }
  }
  const [r, g, b] = rgb.map((channel) => Math.round(encode(Math.min(1, Math.max(0, channel))) * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Linear-light sRGB of `hsl(hue 100% 50%)`. */
function hslStop(hue: number): Rgb {
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return decode(0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [channel(0), channel(8), channel(4)];
}

/** OKLab hue angle in radians of a linear-light sRGB colour (Björn Ottosson's matrices). */
function oklabHue([r, g, b]: Rgb): number {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return Math.atan2(bAxis, a);
}

function oklabToLinear(lightness: number, a: number, b: number): Rgb {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** sRGB transfer: encoded 0…1 to linear light. */
function decode(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** sRGB transfer: linear light to encoded 0…1. */
function encode(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

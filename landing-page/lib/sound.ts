"use client";

import { Howl, Howler } from "howler";
import banks from "@/app/data/sfx.json";

/**
 * hatom.com's sound, played through Howler the way its AudioPlayer does:
 *
 * - UI effects and the egg's rollover chimes (two sprite banks);
 * - two looping music themes, started just after the enter click. The egg
 *   theme plays at the top of the page and crossfades to the griffin theme
 *   once the hero has transformed; each fades in over 1.5 s when it starts
 *   or loops, and out over the last 1.5 s of the track;
 * - one-off cues at scroll moments, which fade out if you scroll back;
 * - everything muted while the tab is hidden.
 *
 * Sound is off by default on every visit. The sound switch on the welcome
 * screen (top right) or in the header turns it on; entering the site never
 * does. Once on, the music starts with the enter burst, or straight away if
 * it's switched on after entering.
 */
export type SfxName = keyof typeof banks.sfx.sprite;
export type Scene = keyof typeof banks.themes;
export type CueName = keyof typeof banks.cues;

/** hatom's FADE_DURATION. */
const FADE = 1500;
const VOLUME = { sfx: 0.45, chimes: 0.3, theme: 0.5, cue: 0.5 };
const CHIMES = Object.keys(banks.rollovers.sprite);

/** JSON arrays -> Howler's [start, duration] tuples. */
const sprite = (entries: Record<string, number[]>) =>
  Object.fromEntries(Object.entries(entries).map(([name, [start, duration]]) => [name, [start, duration] as [number, number]]));

let sfx: Howl | undefined;
let chimes: Howl | undefined;
let chimeId: number | undefined;
const cues: Partial<Record<CueName, Howl>> = {};
let themes: Record<Scene, Howl> | undefined;
let scene: Scene = "egg";
let enabled = false;
let entered = false;
let hiddenMute = false;
const listeners = new Set<() => void>();

function load() {
  sfx ??= new Howl({ src: [banks.sfx.src], sprite: sprite(banks.sfx.sprite), volume: VOLUME.sfx });
  chimes ??= new Howl({ src: [banks.rollovers.src], sprite: sprite(banks.rollovers.sprite), volume: VOLUME.chimes });
}

/** A looping theme that fades in whenever it (re)starts and out before it ends, while it's the current one. */
function createTheme(name: Scene) {
  let fadingOut = false;
  const theme = new Howl({
    src: [banks.themes[name]],
    loop: true,
    html5: true,
    volume: 0,
    onplay: () => {
      fadingOut = false;
      if (scene === name) theme.fade(0, VOLUME.theme, FADE);
    },
  });
  const watchEnd = () => {
    const duration = theme.duration();
    const time = theme.seek() as number;
    if (duration && time > duration - FADE / 1000 && !fadingOut) {
      fadingOut = true;
      if (scene === name) theme.fade(theme.volume() as number, 0, (duration - time) * 1000);
    }
  };
  window.setInterval(watchEnd, 200);
  theme.play();
  return theme;
}

/** hatom starts both themes together and moves the volume between them. */
function startThemes() {
  if (themes) return;
  themes = { egg: createTheme("egg"), griffin: createTheme("griffin") };
}

function setEnabled(value: boolean) {
  enabled = value;
  if (value) {
    load();
    if (entered) startThemes();
  }
  Howler.mute(!value || hiddenMute);
  listeners.forEach((listener) => listener());
}

// hatom mutes while the tab is hidden and restores the sound when it's back.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    hiddenMute = document.hidden;
    Howler.mute(!enabled || hiddenMute);
  });
}

export const sound = {
  toggle() {
    setEnabled(!enabled);
    if (enabled) sound.play("ClickUI");
  },
  isEnabled: () => enabled,
  play(name: SfxName) {
    if (enabled) sfx?.play(name);
  },
  /** One of the five egg rollover chimes, at random. */
  chime() {
    if (enabled) chimeId = chimes?.play(CHIMES[Math.floor(Math.random() * CHIMES.length)]);
  },
  /** hatom chimes on a fast scroll, but never over a chime that's still ringing. */
  scrollChime() {
    if (!enabled || (chimeId !== undefined && chimes?.playing(chimeId))) return;
    sound.chime();
  },
  /** The music, started just after the enter burst (hatom's playThemes). */
  startMusic() {
    entered = true;
    if (enabled) startThemes();
  },
  /** Crossfades to the theme for this part of the page. */
  setScene(next: Scene) {
    if (next === scene) return;
    scene = next;
    if (!themes) return;
    const [incoming, outgoing] = next === "egg" ? [themes.egg, themes.griffin] : [themes.griffin, themes.egg];
    outgoing.fade(outgoing.volume() as number, 0, FADE);
    incoming.fade(incoming.volume() as number, VOLUME.theme, FADE);
  },
  /** A one-off cue; if it's still playing it just comes back up. */
  cue(name: CueName) {
    if (!enabled) return;
    const howl = (cues[name] ??= new Howl({ src: [banks.cues[name]], volume: VOLUME.cue }));
    if (howl.playing()) howl.fade(howl.volume() as number, VOLUME.cue, 1000);
    else {
      howl.volume(VOLUME.cue);
      howl.play();
    }
  },
  /** Scrolling back past a cue fades it out. */
  fadeCue(name: CueName) {
    const howl = cues[name];
    if (howl?.playing()) howl.fade(howl.volume() as number, 0, 1000);
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

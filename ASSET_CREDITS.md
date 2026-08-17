# Asset Credits

Third-party assets bundled in this repository, and where they came from.

Everything else — all sound effects, all in-game graphics, and the site UI — is
generated at runtime by this project's own code. There are no other external
assets: sound effects are synthesized with the Web Audio API (`packages/app/src/audio.ts`),
game visuals are drawn on a canvas, and the UI uses system fonts only.

## Music

Every track is released under **CC0 1.0** (public domain dedication) on OpenGameArt.

By **congusbongus** (https://opengameart.org/users/congusbongus):

| Track | File | Source |
|---|---|---|
| Midnight Drive | `midnight_drive` | https://opengameart.org/content/midnight-drive |
| Head in the Sand (seamless loop) | `headinthesand` | https://opengameart.org/content/head-in-the-sand-seamless-loop |
| Escape from Metal City | `escape_from_metal_city` | https://opengameart.org/content/escape-from-metal-city |
| Blue Intermission | `blue_intermission` | https://opengameart.org/content/blue-intermission |
| Assault | `assault` | https://opengameart.org/content/assault |

By **yd** (https://opengameart.org/users/yd):

| Track | File | Source |
|---|---|---|
| Another space background track | `observing_the_star` | https://opengameart.org/content/another-space-background-track |

- License: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/
- Files live in `packages/app/public/bgm/`.
- The `observing_the_star` file is renamed from the author's `ObservingTheStar.ogg`
  only to match the naming of the other tracks; the audio is untouched. The
  author's archive also contains an LMMS project file, which this repository does
  not ship.
- **Each track ships in two formats.** The `.ogg` files are the originals as
  downloaded. The `.m4a` files are AAC transcodes made by
  `scripts/encode-bgm.mjs` — the audio is otherwise unaltered (same length, no
  edits), and they exist only because iOS Safari cannot decode Ogg Vorbis.
  CC0 imposes no conditions on modification; this note is for accuracy, not
  obligation.

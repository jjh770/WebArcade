# Asset Credits

Third-party assets bundled in this repository, and where they came from.

Everything else — all sound effects, all in-game graphics, and the site UI — is
generated at runtime by this project's own code. There are no other external
assets: sound effects are synthesized with the Web Audio API (`packages/app/src/audio.ts`),
game visuals are drawn on a canvas, and the UI uses system fonts only.

## Music

The following tracks were created by **congusbongus** and released under
**CC0 1.0** (public domain dedication) on OpenGameArt.

| Track | File | Source |
|---|---|---|
| Midnight Drive | `midnight_drive` | https://opengameart.org/content/midnight-drive |
| Head in the Sand (seamless loop) | `headinthesand` | https://opengameart.org/content/head-in-the-sand-seamless-loop |
| Escape from Metal City | `escape_from_metal_city` | https://opengameart.org/content/escape-from-metal-city |
| Blue Intermission | `blue_intermission` | https://opengameart.org/content/blue-intermission |
| Assault | `assault` | https://opengameart.org/content/assault |

- Artist profile: https://opengameart.org/users/congusbongus
- License: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/
- Files live in `packages/app/public/bgm/`.
- **Each track ships in two formats.** The `.ogg` files are the originals as
  downloaded. The `.m4a` files are AAC transcodes made by
  `scripts/encode-bgm.mjs` — the audio is otherwise unaltered (same length, no
  edits), and they exist only because iOS Safari cannot decode Ogg Vorbis.
  CC0 imposes no conditions on modification; this note is for accuracy, not
  obligation.

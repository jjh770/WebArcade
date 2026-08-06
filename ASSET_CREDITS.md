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
| Midnight Drive | `midnight_drive.ogg` | https://opengameart.org/content/midnight-drive |
| Head in the Sand (seamless loop) | `headinthesand.ogg` | https://opengameart.org/content/head-in-the-sand-seamless-loop |
| Escape from Metal City | `escape_from_metal_city.ogg` | https://opengameart.org/content/escape-from-metal-city |
| Blue Intermission | `blue_intermission.ogg` | https://opengameart.org/content/blue-intermission |
| Assault | `assault.ogg` | https://opengameart.org/content/assault |

- Artist profile: https://opengameart.org/users/congusbongus
- License: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/
- Files live in `packages/app/public/bgm/` and are served as-is (unmodified).

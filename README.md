# Aether

**Shape light with your hands and your voice.**
Aether is a browser experience: your webcam finds your hands, 20,000 glowing particles react to your gestures, and you change the world by speaking.
There is nothing to install and no account. The camera picture never leaves your computer.

![A spiral galaxy made of 20,000 particles](docs/galaxy.png)

| Make a fist: black hole | Open the hand: explosion |
| --- | --- |
| ![Black hole with an accretion ring](docs/black-hole.png) | ![The galaxy explodes](docs/explosion.png) |

| Say "rainbow" | Say "ice" |
| --- | --- |
| ![Rainbow torus knot](docs/rainbow.png) | ![Snowflake made of particles](docs/ice.png) |

## Worlds

| # | World | Idea | Status |
| --- | --- | --- | --- |
| 01 | **Hand Magic** (`/hand`) | Particles follow your hand. Fist, open hand, pinch, two hands. | ✅ Ready |
| 02 | Air Drawing (`/draw`) | Draw in the air, the lines float as a 3D neon sculpture. | Planned |
| 03 | Hologram Mirror (`/mirror`) | The camera turns you into a hologram of particles or letters. | Planned |
| 04 | Voice World (`/voice`) | Your voice grows a living landscape. | Planned |

### Hand Magic: what you can do

| Gesture | What happens |
| --- | --- |
| ☝️ Move your index finger | Particles swirl around your finger and follow it |
| ✊ Make a fist and hold it | A black hole opens and grows, the galaxy is pulled into its ring |
| 🖐️ Open the fist | The black hole explodes. The bigger it was, the bigger the bang |
| 🤏 Pinch, move, let go | You grab a star and throw it. It flies like a comet and bounces off the edges |
| 🙌 Two hands apart or together | Zoom the whole world |

**Voice commands** (English): `fire`, `ice`, `galaxy`, `rainbow`, `save`, `next world`.
**Keyboard:** `1`–`4` elements, `S` save a picture, `C` camera picture, `N` next world.
**No camera?** Play with the mouse: hold the left button for a black hole, let go to explode, right button to throw a star, wheel to zoom.

## How it works

```
webcam ──► MediaPipe Hand Landmarker (WebAssembly + GPU, in the browser)
              │  21 points per hand, up to 2 hands
              ▼
          gestures.ts   simple geometry: finger stretch ratios, thumb–index distance,
              │         a 3-frame stabilizer and a One Euro filter against jitter
              ▼
          controller.ts the rules: fist → black hole, fist → open → explosion, pinch → star
              ▼
          world.ts      20,000 particles: spring to the element's shape, swirl, gravity,
              │         explosion impulses. Three.js points + bloom post-processing
              ▼
          screen        ◄── voice.ts (Web Speech API) switches the element
                        ◄── sound.ts (Web Audio) makes every sound live, no audio files

saved picture ──► FastAPI /api/gallery ──► file on disk + row in SQLite
```

- **Frontend:** React 19, TypeScript, Vite, Three.js, MediaPipe Tasks Vision, Web Speech API, Web Audio API
- **Backend:** FastAPI, SQLite, served by Uvicorn. After a build it also serves the website, so everything runs on one port.
- **Tests:** Vitest for the gesture rules and voice matching, pytest for the gallery API.

### Privacy

- Hand detection runs fully in the browser. No video frame is sent anywhere.
- The hand model file (about 8 MB) is loaded from Google's MediaPipe model storage when you start the camera.
- Voice commands use the browser's speech recognition. Edge and Chrome send the audio to their speech service to turn it into text.
- Saved pictures stay on your computer (`backend/data`).

## Run it

You need Python 3.11+ and Node.js 20+.

**Windows, one click:** double-click `start.cmd`. The first start installs everything, then the site opens at http://127.0.0.1:8020.

**Development (two terminals):**

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # macOS/Linux: .venv/bin/python
.venv/Scripts/python -m uvicorn app.main:app --port 8020 --reload
```

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, /api is forwarded to port 8020
```

Use Edge or Chrome. The camera only works on `localhost`, `127.0.0.1` or HTTPS.

**Tests:**

```bash
cd frontend && npm test && npm run typecheck
cd backend && .venv/Scripts/python -m pytest
```

## Project layout

```
backend/
  app/main.py        FastAPI app: gallery API, saved images, built website
  app/gallery.py     image validation, files on disk, SQLite
  tests/             pytest
frontend/
  src/engine/        particle world (Three.js) and the four element shapes
  src/vision/        camera + MediaPipe, gesture rules (unit tested)
  src/voice/         speech recognition and command matching (unit tested)
  src/audio/         sounds made with Web Audio
  src/worlds/hand/   Hand Magic: rules and the frame loop
  src/pages/         start page, worlds, gallery
start.cmd            install, build and run on Windows
```

# AI + AR Object Finder

A mobile-web prototype that combines **Gemini 3 spatial understanding** for open-vocabulary object detection with **8th Wall SLAM** world tracking to place persistent AR text labels on real-world objects — entirely in the browser.

## How It Works

1. Open the app on a mobile phone (Safari on iOS, Chrome on Android).
2. Enter your Gemini API key and pick a detection model.
3. Tap **Start AR Camera** — the rear camera opens with SLAM world tracking.
4. Type an object name (e.g. `printer`, `coffee mug`, `keyboard`) and tap **Find**.
5. Gemini analyzes the current camera frame and returns a bounding box.
6. The app raycasts the bounding-box center into the 8th Wall 3D scene and anchors a floating text label at that position.
7. Move the phone around — the label stays attached in world space.
8. Tap **Delete Label** to remove it, or type a new object to search again.
9. Tap **Close** to end the session and return to the landing screen.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Mobile Browser (Safari / Chrome)               │
│                                                  │
│  index.html ─── app.js (state machine)          │
│                   ├── detection.js               │
│                   │     └── @google/genai (CDN)  │
│                   │          → Gemini API        │
│                   ├── ar-engine.js               │
│                   │     └── 8th Wall XR8         │
│                   │          + Three.js           │
│                   └── ui.js                      │
└─────────────────────────────────────────────────┘
```

Everything runs client-side. The only network call is from the browser directly to the Gemini API.

### Module Separation

| Module | Responsibility |
|---|---|
| `js/modules/detection.js` | Captures frame, calls Gemini, returns `{ found, box, label }` |
| `js/modules/ar-engine.js` | 8th Wall init/teardown, 2D→3D raycast, label sprite management |
| `js/modules/ui.js` | DOM show/hide, status messages, button event wiring |
| `js/app.js` | State machine connecting everything |

## Detection Models

Two Gemini models are available, selectable on the landing screen:

| Model | ID | Speed | Accuracy |
|---|---|---|---|
| **Flash-Lite** (default) | `gemini-3.1-flash-lite-preview` | Fastest, sub-1s typical | May have lower bounding-box precision |
| **Flash** | `gemini-3-flash-preview` | 1–3s typical | Higher spatial understanding accuracy |

Both use Gemini's structured output mode with a JSON schema enforcing `[{ box_2d: [y_min, x_min, y_max, x_max], label }]` format (coordinates normalized 0–1000).

## Setup

### Prerequisites

- A **Gemini API key** — get one free at https://aistudio.google.com/apikey
- The **8th Wall standalone engine** — download `xr-standalone.zip` from https://8th.io/xrjs

### Install

```bash
git clone <this-repo>
cd 8thWallDemo

# Unzip the 8th Wall engine into xr/
# After unzipping you should have xr/xr.js (plus chunk files)
unzip ~/Downloads/xr-standalone.zip -d xr/
```

### Run Locally

Any static file server works. Camera access requires HTTPS (or localhost).

```bash
# Option A: npx serve (Node.js)
npx serve . -l 8080

# Option B: Python
python3 -m http.server 8080

# Option C: VS Code Live Server extension
```

For **mobile testing over local network**, use ngrok to get an HTTPS URL:

```bash
ngrok http 8080
# Open the https://...ngrok-free.app URL on your phone
```

### Deploy to GitHub Pages

1. Push the repo to GitHub (make sure `xr/` files are committed or use Git LFS).
2. Go to **Settings → Pages** → set source to `main` branch, root `/`.
3. Open `https://<username>.github.io/<repo>/` on your phone.
4. GitHub Pages provides HTTPS automatically — camera access works.

## Project Structure

```
8thWallDemo/
  index.html          Single-page app: landing + AR view
  css/
    styles.css        Mobile-first styles
  js/
    app.js            State machine / controller
    modules/
      detection.js    Gemini API integration (client-side)
      ar-engine.js    8th Wall + Three.js adapter
      ui.js           DOM management
  xr/                 8th Wall engine files (download separately)
  README.md
```

## How 2D Detection Maps to 3D Anchors

This is the key technical challenge of the prototype:

1. **Gemini** returns a 2D bounding box `[y_min, x_min, y_max, x_max]` in the image (normalized 0–1000).
2. **ar-engine.js** computes the center of that box and converts it to normalized device coordinates.
3. A **Three.js Raycaster** fires a ray from the camera through that screen point.
4. If the ray hits the **invisible ground plane** (y=0), the label is placed at the intersection — this works well for objects on floors and tables.
5. If no surface is hit (object is on a wall, shelf, etc.), the label is placed at a **fallback distance of 2 meters** along the ray.
6. Once placed, the `THREE.Sprite` exists in world space. 8th Wall's SLAM continuously updates the camera pose, so the label **stays anchored** as the phone moves.

The UI reports whether the anchor is "on surface" (precise) or "approximate depth."

## Known Limitations

- **API key in browser** — The key is entered by the user and held in `sessionStorage` (cleared on tab close). It's visible in DevTools. Use a server proxy or Firebase AI Logic for production.
- **Depth estimation is approximate** — Gemini returns 2D boxes, not depth. Vertical objects (shelves, walls) get a fallback fixed-distance anchor.
- **Detection is not real-time** — Each call takes 0.5–3s depending on model. This is a "detect then anchor" flow, not continuous tracking.
- **Single label at a time** — Prototype limitation for simplicity.
- **SLAM initialization** — 8th Wall needs a few seconds of camera movement to establish tracking. Labels placed during LIMITED tracking may drift.
- **Preview models** — Both model IDs are preview releases; strings may change when GA.
- **Flash-Lite spatial accuracy** — Bounding-box precision on Flash-Lite is unverified for spatial understanding tasks. The model selector lets you compare.
- **8th Wall binary** — The SLAM engine is free to use but distributed under a binary-only license (not MIT).

## Next Experiments

- Benchmark Flash-Lite vs Flash bounding-box accuracy side by side
- Replace Gemini with on-device ML (MediaPipe) for real-time detection
- Use Gemini thinking mode for better spatial reasoning
- Add multi-label support
- Try WebXR Hit Test API as an alternative AR layer
- Add visual bounding-box overlay before anchor confirmation
- Migrate to stable Gemini 3 model strings when available
- Add Firebase AI Logic for production-safe API key handling

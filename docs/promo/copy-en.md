# Microduck Arena · English Promo Copy

> One tailored version per platform — not copy-paste duplicates. Grab a block and post it.
> Link roundup and image guidance in [README.md](./README.md).

---

## 1. Dev.to / Blog (long form)

### Title options

- I Built a 3v3 Reinforcement Learning Football Game — Entirely in the Browser
- Six AI Robot Ducks Play Football in Your Browser (No Backend, MIT Licensed)
- MuJoCo + ONNX in the Browser: A Zero-Backend RL Football Arena

### Body

Here's a thing I probably shouldn't have been able to build: a full 3v3 football match played by six reinforcement-learning robot ducks, running **entirely in the browser**. No server, no backend, no WebSocket farm — just a static site you open and watch.

It's called **Microduck Arena**.

🎮 **Live demo:** https://microduck-arena.com/
🐙 **Source (MIT):** https://github.com/00make/microduck-arena

Load the page and you drop straight into football mode: red team vs blue team, six ducks, each with a role — goalkeepers, defenders, forwards — plus a full referee system handling kickoffs, offsides, goals, and corner kicks. Want to just mess around with a single duck and some physics toys? That's sandbox mode at https://microduck-arena.com/?mode=sandbox

【Image: 3v3 football match screenshot — neon pitch, red vs blue】

---

#### Where the ducks come from

I didn't design the robot from scratch. The body is **microduck**, a 25cm bipedal robot duck open-sourced by the French robotics team **Pollen Robotics** (https://github.com/pollen-robotics/microduck).

The "skills" — walking, kicking, rolling, getting back up — are PPO policies trained in their RL environment **microduck_rl** (https://github.com/pollen-robotics/microduck_rl) on top of MuJoCo, exported to ONNX. My job was to take that trained brain + simulated body and run it live in a browser with zero server, then wire up six of them into a football match.

---

#### The hard part: physics + neural inference in a browser tab

Most people's first instinct is "surely you need a backend for the simulation." You don't. The whole stack is:

**React + Vite + Three.js + MuJoCo WASM + ONNX Runtime + Trystero (WebRTC) + Zustand**

Three pieces matter:

**1) MuJoCo compiled to WebAssembly**

The MuJoCo physics engine runs as WASM, doing full rigid-body simulation right in the tab. Two frequencies worth separating:

- **200Hz physics** — the base `timestep = 0.005s`, 200 solver steps per second.
- **50Hz control loop** — a policy inference + action dispatch every 4 physics steps (`decimation = 4`), i.e. `CTRL_DT = 0.02s`.

That 50Hz isn't arbitrary — it matches the real microduck robot's onboard realtime control rate exactly. So the gait you see in the browser is the same gait the physical duck walks with.

**2) Nine ONNX neural policies, real-time inference**

Every duck movement is backed by a neural network. The project ships **9 ONNX policies**: walking, sit/stand, roll, left/right kicks, ground pick, fall recovery, plus the roller variant's drive and crouch-glide.

- Each policy consumes a **61-dim observation** (joint angles, angular velocities, gravity projection, commanded velocity) and emits a **14-dim action** (one per joint).
- Inference runs on **onnxruntime-web**, measured at **<2ms per step** — so six ducks running policies simultaneously still leaves the frame budget wide open.

【Image: kick moment / policy-switch diagram】

**3) WebRTC P2P multiplayer, zero backend**

For multiplayer I run **no server at all**. It uses **Trystero**, which does WebRTC P2P with Nostr relays for signaling — duck state broadcasts peer-to-peer at 15Hz. The whole site is a pile of static files you can drop on any CDN or container host: no database, no API, no ops.

---

#### An architecture note

I deliberately split the frontend: **React is just the UI shell** (menus, HUD, overlays). The actual game core is imperative, framework-agnostic JavaScript — physics, AI, and the render loop all live there. A **Zustand** store bridges the two: game state flows out to the UI, UI intents flow back into the core.

The payoff: the game loop never gets throttled by React's render cadence, so the 50Hz control rate stays rock-solid, while the UI still gets React's developer experience. 3D rendering is React Three Fiber + Three.js. The arena is cyberpunk Tron-styled — neon grid floor, custom GLSL shaders, CRT post-processing — and goals trigger comic-book cutscenes.

【Image: Tron arena + comic cutscene panel】

---

#### Two ways to play

- **⚽ Football (default):** 3v3, six AI ducks auto-play, full referee system, post-match stats. Just open https://microduck-arena.com/
- **🦆 Sandbox:** one duck free-roaming with a pile of '90s physics toys — arcade cabinets, a skateboard, a walkman — plus minigames. Full keyboard, touch, and gamepad support. https://microduck-arena.com/?mode=sandbox

---

#### Open source

The whole thing is **MIT licensed** — fork it, learn from it, open issues and PRs:

- 🐙 GitHub: https://github.com/00make/microduck-arena
- 🤗 Hugging Face Space: https://huggingface.co/spaces/00make/microduck-arena
- 🎮 Live demo: https://microduck-arena.com/

Stack recap: React + Vite + Three.js + MuJoCo WASM + ONNX Runtime + Trystero (WebRTC) + Zustand.

Credits: robot design by Pollen Robotics, RL policies trained with microduck_rl, physics by MuJoCo (Google DeepMind), inference by ONNX Runtime Web (Microsoft), P2P by Trystero (Dan Motzenbecker).

If "an RL football team running in a browser tab" sounds as fun to you as it did to me, a star on the repo is hugely appreciated 🦆⚽

---

## 2. Reddit (per-subreddit angles)

> Keep the tone conversational, lead with the interesting engineering, drop links at the end.
> Read each sub's self-promo rules first; participate in comments.

### r/robotics — physical simulation + RL policies

**Title:** I got six RL robot ducks playing 3v3 football — physics and policies running fully in the browser

Body: The robot is Pollen Robotics' open-source **microduck** (25cm biped). I took the PPO locomotion/kick/roll policies trained in **microduck_rl** and run them live in a browser tab — MuJoCo compiled to WASM for the rigid-body sim, ONNX Runtime Web for inference. Control loop is 50Hz to match the real robot's onboard rate (200Hz physics under the hood). Six of them play an autonomous 3v3 match with a referee system; there's also a single-duck sandbox. No backend anywhere — it's a static site.

Curious how this compares to sim2real folks' expectations: the browser gait is literally the deployed control rate, so it's a faithful preview of the hardware.

- Demo: https://microduck-arena.com/
- Code (MIT): https://github.com/00make/microduck-arena

### r/MachineLearning — in-browser ONNX inference + policy architecture

**Title:** Running 9 ONNX RL policies in-browser at <2ms/step (61-dim obs → 14-dim action)

Body: I ship nine PPO policies (walk, sit/stand, roll, kicks, ground-pick, fall-recovery, roller drive/crouch) as ONNX and run them with **onnxruntime-web** in the browser. Each takes a 61-dim observation (joint angles, angular velocities, gravity projection, commanded velocity) and outputs a 14-dim action (one per joint). Single-step inference measures under 2ms, so six agents run concurrently without blowing the frame budget. Physics is MuJoCo WASM at 200Hz with a decimation of 4 → 50Hz control. Everything is client-side, zero backend.

Happy to share obs layout / action-scaling details if anyone's porting policies to the web.

- Demo: https://microduck-arena.com/
- Code (MIT): https://github.com/00make/microduck-arena

### r/WebAssembly — MuJoCo WASM + performance numbers

**Title:** MuJoCo compiled to WASM running a real-time physics sim in the browser (200Hz, zero backend)

Body: I run the full MuJoCo rigid-body engine as WebAssembly in a browser tab — 200Hz physics steps, 50Hz control loop, six articulated agents plus a ball, all client-side. Neural inference is ONNX Runtime Web (also WASM), <2ms/step. The entire app is a static site: no server, multiplayer is WebRTC P2P via Trystero/Nostr. It holds a steady frame budget even with everything running at once.

If you're evaluating heavy numeric WASM workloads on the web, this is a decent real-world reference for what's feasible.

- Demo: https://microduck-arena.com/
- Code (MIT): https://github.com/00make/microduck-arena

### r/gamedev — browser game architecture, zero backend

**Title:** A browser game with zero backend: imperative game core + React UI shell, bridged by Zustand

Body: Architecture question I solved the hard way — how to keep a fixed 50Hz game loop smooth while using React for UI. My answer: React is only the chrome (menus, HUD, overlays); the game core is imperative, framework-agnostic JS (physics, AI, render loop). A Zustand store bridges them — state flows out to UI, intents flow in. Rendering is React Three Fiber + Three.js with a Tron-neon arena, GLSL shaders, CRT post-processing, and comic-book goal cutscenes. Multiplayer is WebRTC P2P (Trystero), so there's no server at all — just static files.

Happy to dig into the loop/bridge pattern if anyone's wrestling with the same thing.

- Demo: https://microduck-arena.com/
- Code (MIT): https://github.com/00make/microduck-arena

---

## 3. Twitter / X Thread (5–8 tweets)

> Each tweet stands alone but flows as a story. Attach a GIF/screenshot to tweets 1, 3, 5, 7.

**1/**
I built a 3v3 football game where all six players are reinforcement-learning robot ducks — and it runs *entirely in your browser*. No backend. No server. Just open a URL and watch them play. 🦆⚽

Play it: https://microduck-arena.com/
【Attach: match GIF】

**2/**
The ducks are real hardware: Pollen Robotics' open-source **microduck**, a 25cm bipedal robot. Their walking/kicking/rolling skills are PPO policies trained in microduck_rl on MuJoCo, exported to ONNX. I brought that brain + body to the web.

**3/**
Physics runs in the tab: **MuJoCo compiled to WebAssembly**. 200Hz physics steps, 50Hz control loop (decimation of 4). That 50Hz matches the real robot's onboard control rate — so the browser gait is the hardware gait.
【Attach: gait/physics clip】

**4/**
Nine **ONNX neural policies** power every move — walk, kick, roll, get-up, ground-pick, roller variants. Each takes a 61-dim observation → 14-dim action. Inference is ONNX Runtime Web at **<2ms per step**, so six ducks run at once with room to spare.

**5/**
Multiplayer has **zero backend**. It's WebRTC P2P via Trystero (Nostr relays for signaling) — duck state syncs peer-to-peer at 15Hz. The whole site is static files you can drop on any CDN.
【Attach: arena screenshot】

**6/**
Stack: React + Vite + Three.js (R3F) + MuJoCo WASM + ONNX Runtime + Trystero + Zustand. React is just the UI shell; the game core is imperative JS, bridged by a Zustand store. Tron-neon arena, GLSL shaders, CRT post-FX, comic-book goal cutscenes.

**7/**
Two modes: ⚽ Football (default) — autonomous 3v3 with a full referee system. 🦆 Sandbox — one duck + '90s physics toys, keyboard/touch/gamepad. Try it: https://microduck-arena.com/?mode=sandbox
【Attach: sandbox GIF】

**8/**
It's fully **MIT open source** — code, policies, assets. Fork it, break it, send PRs.

🐙 https://github.com/00make/microduck-arena
🤗 https://huggingface.co/spaces/00make/microduck-arena

If an RL football team in a browser tab is your kind of fun, a star means a lot 🦆

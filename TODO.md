# Microduck Arena — TODO

## 🚀 Deployment

- [x] Push to GitHub (`git add . && git commit -m "Initial commit" && git push`)
- [ ] Set up Cloudflare Pages project
  - Build command: `cd app && npm ci && npm run build`
  - Build output: `app/dist`
  - Environment variable: `NODE_VERSION=22`
  - Custom domain: `microduck-arena.com`
- [ ] Configure DNS: point `microduck-arena.com` → Cloudflare Pages
- [ ] Verify HF Spaces Docker rebuild with new nginx.conf
- [x] Set up GitHub Actions CI (npm test + npm run test:headless)

## 📸 Assets

- [ ] Record demo video (3v3 football match, 30-60s)
- [ ] Take screenshot (football mode HUD + arena)
- [ ] Take screenshot (sandbox mode)
- [ ] Create architecture diagram (optional)
- [ ] Update README.md with screenshot/GIF
- [ ] Update README_zh.md with screenshot/GIF

## 📝 Content & Promotion

- [ ] Write technical blog post (Chinese: 知乎/掘金, English: Dev.to)
- [ ] Record Bilibili demo video
- [ ] Post on Reddit (r/robotics, r/MachineLearning, r/WebAssembly)
- [ ] Post on Twitter/X with video + thread
- [ ] Post on V2EX / 即刻
- [ ] Publish ONNX policies as HF Model

## 🔧 Code Improvements

- [x] Self-host Anton font (remove Google Fonts CDN dependency)
- [x] Add HTML meta tags (favicon, description, Open Graph)
- [x] Add WASM preload hints in index.html
- [x] Fix vite.config.js stale comment (verified: comment is accurate, no change needed)
- [x] Set up CI/CD pipeline

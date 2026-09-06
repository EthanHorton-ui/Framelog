# FrameLog

Private progress-photo app. No account, no cloud, no ads.
Photos and measurements live in this browser on this phone.

## Use it on iPhone

1. Copy the `framelog` folder to your computer, or host the folder anywhere HTTPS is available (GitHub Pages, Netlify Drop, Cloudflare Pages).
2. Open `index.html` in **Safari** (camera access needs a real origin — `https://` or `localhost`, not a raw files app).
3. Tap Share → **Add to Home Screen**.
4. Open FrameLog from the home screen. It runs full-screen like an app.

Quick local test on a computer:

```bash
cd framelog
python3 -m http.server 4173
```

Then open `http://localhost:4173` on the same machine, or `http://YOUR-LAN-IP:4173` on your phone (same Wi-Fi).

## What it does

- Camera capture with front/rear flip and a 3-second timer
- Ghost overlay of your last photo in that pose, so stance and crop stay consistent
- Tags: Front / Side / Back / Flex
- Weight plus chest, shoulders, waist, hips, arms, legs, calves
- Timeline gallery
- Side-by-side compare or a before/after slider
- Weight and tape-measure trend lines
- Optional 4-digit PIN
- Import from the camera roll
- JSON backup export / import

## Privacy

Everything is stored in IndexedDB for this site. Clearing Safari data for the site deletes it. Export a backup first if you change phones.

The PIN is a lock screen only. It is not encryption.

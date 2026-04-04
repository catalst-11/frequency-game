# Color Recall Challenge

A polished browser game inspired by the uploaded Dialed-style brief.

## Core features implemented

- Five-color memorization challenge
- Solo mode
- Daily mode with one local attempt per browser per day
- Shareable challenge mode using URL seeds
- Easy and Hard difficulty
- HSB reconstruction controls
- Perceptual scoring pipeline:
  - HSV -> RGB -> XYZ -> CIELAB
  - Delta E (CIEDE2000)
  - S-curve base score
  - hue recovery and hue penalty adjustments
- Server-backed leaderboard (SQLite `scores.db`) with summary API
- Local challenge leaderboard for shared links
- Server daily challenge cache (UTC day, shared 5 colors for all devices)
- Daily lock: one play per IP per UTC day
- Stage-enter / tile reveal animations
- Built-in Web Audio sound cues with mute toggle
- Rich final analytics cards (accuracy, DeltaE, consistency, bias)
- Responsive UI with a premium game-like visual style

## Files

- `index.html` – structure
- `styles.css` – visual design and responsive layout
- `app.js` – game logic, scoring, seeded generation, storage, and UI flow

## How to run

1. Install dependencies:
   - `npm install`
2. Start the server:
   - `npm start`
3. Open:
   - `http://localhost:3000`

If port `3000` is already in use, the server now auto-falls back to the next free port (`3001`, `3002`, ...). Check the startup log line `Color Recall server listening on ...` for the active URL.

### Multi-server merged classement

Run each server with its own `PORT` and list peer servers in `PEER_SERVERS`.

Example:
- Server A: `PORT=3000 PEER_SERVERS=http://localhost:4000 npm start`
- Server B: `PORT=4000 PEER_SERVERS=http://localhost:3000 npm start`

With this, saving score on either port replicates to peers, and `/api/scores` returns merged classement data.

## Notes

This version now includes a backend API and SQLite database:
- leaderboard scores are saved on the server file (`scores.db`, table `scores`)
- if a player finishes with an empty name, the app prompts again at the end before saving
- leaderboard display reads from server APIs (not device-local browser cache)

Useful endpoints:
- `GET /api/scores?limit=100` (array format, backward-compatible)
- `GET /api/leaderboard?limit=100&mode=solo&difficulty=hard` (entries + summary stats)
- `POST /api/game/start`
- `POST /api/game/checkpoint`
- `POST /api/game/submit`

## CIEDE2000 checker script

Use `ciede2000_score_check.py` to verify round/run scores from terminal:
- `python ciede2000_score_check.py --target 120,75,80 --guess 132,70,78`
- `python ciede2000_score_check.py --rounds-file rounds.json`

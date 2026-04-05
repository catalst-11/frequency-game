# Frequency Guess Challenge

This is an audio-memory game inspired by the original Color Recall layout.

## What it does

- 5-round sound game where players guess the frequency (Hz) of a target tone
- Each round target tone is played once for 5 seconds (no replay)
- Guess phase uses continuous live sound while user moves one vertical left frequency bar
- Bottom live readout shows current frequency and range min/max
- 3D frequency vibe animation (canvas) driven by guessed frequency (`frequency-vibe.js`)
- Backend-secured checkpoint flow (`start -> checkpoint -> submit`) with anti-tamper validation
- SQLite-backed leaderboard table (`frequency_scores`) and session checkpoint tables
- Daily mode process with one play per IP per UTC day (`frequency_daily_*` tables)
- Easy and Hard modes with different frequency ranges and scoring tolerance
- Server leaderboard from `/api/frequency/leaderboard`

## Run it

1. Start the existing project server from repo root:
   - `npm start`
2. Open:
   - `http://localhost:3000/frequency-guess-challenge/`
   - If your server auto-switches port, use that active port instead.

You can also open `frequency-guess-challenge/index.html` directly in a browser.

## Frequency API routes

- `GET /api/frequency/daily?difficulty=easy|hard`
- `GET /api/frequency/leaderboard?limit=100&mode=solo|challenge|daily&difficulty=easy|hard`
- `POST /api/frequency/game/start`
- `POST /api/frequency/game/checkpoint`
- `POST /api/frequency/game/submit`

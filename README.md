# Frequency Game

A web memory game where players listen to a target tone, then guess its frequency using a live slider.

## Modes
- `solo`
- `daily`
- `challenge`

## Frontend
- Path: `frequency-guess-challenge/`
- Main page: `/frequency-guess-challenge/`

## API
- `GET /api/health`
- `GET /api/frequency/daily?difficulty=easy|hard`
- `GET /api/frequency/leaderboard?limit=100&mode=solo|challenge|daily&difficulty=easy|hard`
- `POST /api/frequency/game/start`
- `POST /api/frequency/game/checkpoint`
- `POST /api/frequency/game/submit`

## Run
```bash
npm install
npm start
```

Then open:
- `http://localhost:3000/frequency-guess-challenge/`

# Russian Voice AI Agent

A production-oriented Russian telephone voice agent built around Twilio Media Streams. It recognizes Russian speech with Deepgram, generates concise Russian replies with OpenAI, synthesizes phone audio with ElevenLabs, and sends an after-call summary plus Thai translation to Telegram and an optional webhook.

## Architecture

```text
Twilio call
  -> POST /voice (TwiML greeting + wss://<host>/media)
  -> WebSocket /media
  -> Deepgram Nova-2, Russian, mu-law 8 kHz
  -> OpenAI Chat Completions with per-call conversation memory
  -> ElevenLabs multilingual TTS, mu-law 8 kHz
  -> Twilio audio stream

Call stop/close
  -> Russian transcript and structured OpenAI summary
  -> Thai translation
  -> Telegram message
  -> optional SUMMARY_WEBHOOK_URL POST
```

The production entry point is `twilio-server.js`. `agent-brain.js` loads the conversation rules from `analysis/conversation_logic.json`. Runtime call state is held in memory by Call SID, so a restart clears active conversations and summaries that have not finished.

## Current status

Complete and wired in the production path:

- Twilio inbound voice webhook and outbound call creation
- Twilio bidirectional media WebSocket
- Russian Deepgram speech recognition
- Russian OpenAI conversation with per-call context
- ElevenLabs phone-compatible mu-law audio
- Call finalization protection against duplicate `stop`/`close` handling
- OpenAI call summary and Thai translation
- Telegram summary delivery
- Optional summary webhook
- `/health` endpoint for deployment health checks
- Configurable `PORT` for hosted platforms

The project also contains a separate `vyada-real-estate/` English sandbox with its own package, server, browser UI, and tests. It is not imported by or required for the Russian Twilio agent.

## Required environment variables

Set these as local `.env` values or deployment-platform secrets. Never commit `.env` or place secret values in README files.

Required by the production server:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`
- `DEEPGRAM_API_KEY`

Required for outbound calls:

- `PUBLIC_URL` - public HTTPS base URL of this application, without a trailing slash

Required for Telegram summaries:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Optional:

- `SUMMARY_WEBHOOK_URL`
- `PORT` - supplied by most hosting platforms; defaults to `3000` locally

`dotenv` reads `.env` in local development. In production, configure environment variables in the hosting provider's secret/environment settings. The application does not print API keys or token fragments.

## Local run

Prerequisites: Node.js 18 or newer and a public HTTPS tunnel for real Twilio callbacks.

```powershell
npm install
npm start
```

The server listens on `http://0.0.0.0:3000` by default. For local Twilio testing, start ngrok separately and set `PUBLIC_URL` to its HTTPS URL. Configure the Twilio phone number's voice webhook as `POST <PUBLIC_URL>/voice`.

Useful checks:

```powershell
npm run check
Invoke-WebRequest http://127.0.0.1:3000/health
```

To create an outbound call, send a JSON request to `POST /call` with a `to` phone number. The request uses `PUBLIC_URL/voice` as the TwiML URL.

## Permanent deployment

1. Deploy the repository to a Node.js 18+ service that supports long-lived HTTP and WebSocket connections.
2. Set the start command to `npm start` (or `npm run start:production`).
3. Add all required environment variables in the platform's secret manager. Do not upload `.env`.
4. Let the platform provide `PORT`; the server binds to `0.0.0.0`.
5. Set `PUBLIC_URL` to the stable public HTTPS service URL.
6. In Twilio, set the phone number's incoming voice webhook to `POST <PUBLIC_URL>/voice`.
7. Verify `GET <PUBLIC_URL>/health` returns JSON with `status: "ok"`.
8. Place a controlled inbound test call, then verify the Telegram summary and optional webhook.
9. For outbound calls, call `POST <PUBLIC_URL>/call` with the destination number and confirm the configured Twilio caller ID.

Use a host with WebSocket support and a process manager or managed service that restarts the process after failure. The current in-memory call state is suitable for a single running instance; a multi-instance deployment would require shared call/session state before scaling horizontally.

## Inbound and outbound call flow

### Inbound

1. Twilio sends `POST /voice`.
2. The server returns Russian greeting TwiML and connects Twilio to `/media`.
3. Audio is streamed to Deepgram.
4. Final Russian utterances are grouped, sent to OpenAI with the current call memory, and converted to phone audio by ElevenLabs.
5. The audio is sent back over the Twilio stream.
6. On stream stop or close, the transcript is summarized, translated, and delivered.

### Outbound

1. A trusted caller sends `POST /call` with `{ "to": "..." }`.
2. The server creates a Twilio call using `TWILIO_PHONE_NUMBER` and `PUBLIC_URL/voice`.
3. Twilio enters the same `/voice` and `/media` flow as an inbound call.

## File audit

Confirmed production files:

- `twilio-server.js` - HTTP routes, Twilio WebSocket, Deepgram, OpenAI, ElevenLabs, summaries, translation, Telegram
- `agent-brain.js` - conversation prompt construction
- `analysis/conversation_logic.json` - generated conversation rules
- `package.json` and `package-lock.json` - Node runtime and dependencies

Research or maintenance files, not runtime dependencies:

- `analyze_transcripts.py`, `batch_transcribe.py`, `combine_analysis.py` - offline transcript analysis pipeline
- `call-data/` and `analysis/individual/` - transcript and analysis corpus used to develop the prompt
- `checkVoices.js` - one-off ElevenLabs voice listing utility
- `Test telegram.js` - one-off Telegram delivery test; it is not imported by the server
- `process-record-url.txt` - source transcript/research material
- `output.mp3` - generated local audio artifact

`server.js` is a standalone earlier OpenAI/ElevenLabs demo and is not imported by the production server. `vyada-real-estate/` is a separate, self-contained English sandbox. These files were left in place because they are not proven safe to delete and may be useful as research or demos.

## Validation

`npm run check` validates the production JavaScript syntax. The nested sandbox has independent commands under `vyada-real-estate/` and is not part of the production start command.

# VYADA Real Estate Voice Agent

A focused Node sandbox for English real-estate inbound calls: simulated text or browser microphone → conversation memory → structured requirements → after-call summary → optional Telegram.

## Run locally (PowerShell, Node 22+)

From the existing voice-ai-agent project:

```powershell
cd 'C:\Users\wiyad\OneDrive\Desktop\my project\voice-ai-agent\vyada-real-estate'
Copy-Item .env.example .env
npm start
```

Open **http://127.0.0.1:3030**. Click **Start sandbox call**, type fictional answers, then **End & summarize**. No dependency installation is needed. The app binds only to loopback; use the exact address, not localhost. Stop with Ctrl+C. If running the portable copy, change into that copy's directory instead.

```powershell
npm run demo
npm run call
npm test
npm run lint
```

`demo` always uses the offline parser and Telegram dry run, regardless of environment. `call` is an interactive text call using `.env`; `/end` finishes and generates the summary. Tests never use real credentials or send messages.

## Two conversation modes

**Default mock:** no paid services, no keys, no telephony. This is a conservative guided parser, not a language model. Answer the current question directly; `skip` leaves it missing. Use exact field labels for multiple details or corrections:

```text
intent: rent; property_type: villa; location: Bophut; budget: THB 40–50k/month
bedrooms: 2; timeline: October 2026; lease_duration: 6 months
special_requirements: Pet friendly, pool preferred; viewing_availability: Saturday afternoon
budget: clear
```

**Natural conversation:** set `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL`, and optionally `OPENAI_BASE_URL` in `.env`, then restart. This uses an OpenAI-compatible Chat Completions endpoint with JSON mode. The model must support `response_format: {type: "json_object"}`. `gpt-4o-mini` is the existing project's model, retained as an example, not a promise of availability with every provider. LLM calls may incur usage charges; only fictional data belongs here.

The prompt adapts to friendly, rushed, or concerned callers; it asks one question at a time and avoids flirting or excessive humor. Caller history is retained throughout the current call. Requirements are updated after each accepted turn; missing fields remain `Missing`. Each value must occur verbatim inside evidence from that turn. The validator rejects invented strings, but semantic interpretation still depends on the model: review summaries before relying on them. Relative dates, unspecified currencies, and ambiguous budgets remain exactly as spoken, without invented precision.

## Voice

The local page provides replaceable `BrowserSTT.listen()/stop()` and `BrowserTTS.speak()/stop()` adapters. Enable **Read replies aloud** for English speech output. **Use microphone** listens to one complete utterance, then lets you inspect/edit the transcript before sending it. Recognition needs a supported browser (for example Chrome), microphone permission, and may require the browser vendor's online service. If unsupported, denied, or silent, use text. This is a turn-based inbound-call simulation, not full-duplex telephony or automatic voice activity detection. No audio is stored by this app.

## Telegram

Use your own sandbox bot and sandbox chat. Set these values in `.env` and restart:

```dotenv
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=your-sandbox-bot-token
TELEGRAM_CHAT_ID=your-sandbox-chat-id
```

Finishing a call sends one plain-text summary using Telegram's `sendMessage` endpoint. The UI reports `dry-run`, `sent`, or `failed`. Failed/uncertain delivery keeps the summary available to copy; there is no automatic resend, because a timeout could occur after Telegram accepted the message. Repeated End requests do not resend within the process. Do not copy credentials from the old project's `.env`; this module loads only its own local configuration.

## Lead summary and memory

Fields: buy/rent intent, property type, location, budget, bedrooms, move-in/buying timeline, lease duration, special requirements, viewing availability. Customer vibe is explicitly labeled as an inference. Qualification is a transparent heuristic: intent + location + budget + timeline = medium; additionally viewing availability = high; otherwise needs clarification. It does not predict conversion, assess financial eligibility, or confirm viewings. Lease duration remains missing for buyers and is not asked.

`MemoryStore` owns call-local state keyed by random call ID, adapting the earlier project's Map-per-call and finalization-promise patterns. Calls expire after one hour idle, with at most 100 retained calls and 60 caller turns per call. Restarting clears everything. GET `/api/calls/:id` returns a snapshot; DELETE removes it. No returning-customer matching or persistent database exists. A future store can implement create/get/delete and add separately consented customer identity without coupling it to conversation providers.

## Scope and reuse

Added as a self-contained module in the existing Node `voice-ai-agent` project. Adapted its `agent-brain.js` behavior principles (brief speech, one question, no invented facts, remember answers, respect endings), OpenAI-compatible fetch pattern, and `twilio-server.js` per-call Map/finalization pattern. Existing modules run legacy workflows at import time, so this module does not import them. It has its own commands and no package dependencies.

No FazWaz/company connectors, property search, customer database, outbound calling, Twilio hooks, tunnel, real recordings, or existing analysis data are used. Keep this server local; this MVP has no production authentication or durable delivery queue. The fictional demo is a scenario fixture, not a real listing or customer.

## Verification and reference

`npm test` covers full rental flow, buying, skips, missing data, corrections/retractions, evidence rejection, isolation, expiry, LLM request/malformed output, Telegram success/failure/dry-run/idempotency, HTTP startup, and cross-origin rejection. `npm run lint` checks JavaScript syntax. Browser microphone quality, live LLM behavior, and actual Telegram delivery require manual testing with your sandbox configuration.

API contract checked against the [official Chat Completions reference](https://developers.openai.com/api/reference/cli/resources/chat/subresources/completions).

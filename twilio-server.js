require('dotenv').config();

const express = require('express');
const twilio = require('twilio');
const WebSocket = require('ws');
const http = require('http');
const { systemPrompt } = require('./agent-brain');

const REQUIRED_ENVIRONMENT_VARIABLES = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'DEEPGRAM_API_KEY'
];

function validateEnvironment() {
  const missing = REQUIRED_ENVIRONMENT_VARIABLES.filter(
    (name) => !process.env[name]
  );

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

validateEnvironment();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const VOICE_ID = 'nPczCjzI2devNBz1zQrb'; // тот же голос, что уже использовался

const conversationMemory = new Map(); // память диалога по CallSid
const callMetadata = new Map(); // { from, to, startedAt } по CallSid, нужно для вебхука сводки
const callFinalizationPromises = new Map(); // защита от повторного вызова finalizeCall для одного и того же callSid
const callLanguages = new Map(); // последний определённый язык по CallSid

function detectCallerLanguage(text, previousLanguage = 'ru') {
  const thaiCharacters = (text.match(/[\u0E00-\u0E7F]/g) || []).length;
  const russianCharacters = (text.match(/[А-Яа-яЁё]/g) || []).length;

  if (thaiCharacters > russianCharacters && thaiCharacters > 0) {
    return 'th';
  }

  if (russianCharacters > 0) {
    return 'ru';
  }

  return previousLanguage;
}

// ===============================
// 📞 TWIML — ответ на входящий звонок
// ===============================
app.post('/voice', (req, res) => {
  const { CallSid, From, To } = req.body;
  const configuredPublicUrl = process.env.PUBLIC_URL?.replace(/\/+$/, '');
  const requestHost = req.get('host');
  const configuredPublicHost = configuredPublicUrl
    ? new URL(configuredPublicUrl).host
    : null;
  const streamHost = configuredPublicHost || requestHost;

  console.log('📞 /voice requested', {
    callSid: CallSid || null,
    from: From || null,
    to: To || null,
    requestHost,
    streamHost
  });

  if (CallSid && !callMetadata.has(CallSid)) {
    callMetadata.set(CallSid, {
      from: From || null,
      to: To || null,
      startedAt: Date.now()
    });
  }

  const twiml = new twilio.twiml.VoiceResponse();

  twiml.say(
    { language: 'ru-RU' },
    'Здравствуйте! Добро пожаловать. Чем я могу вам помочь?'
  );

  const connect = twiml.connect();
  connect.stream({ url: `wss://${streamHost}/media` });

  res.type('text/xml');
  const twimlXml = twiml.toString();
  console.log('✅ /voice returned TwiML', { callSid: CallSid || null, streamUrl: `wss://${streamHost}/media` });
  res.send(twimlXml);
});

// ===============================
// 🤖 AI RESPONSE (тот же код, что в server.js)
// ===============================
async function getLLMResponse(userText, callSid, language) {
  const memory = conversationMemory.get(callSid) || [];
  const languageName = language === 'th' ? 'Thai' : 'Russian';

  const messages = [
    {
      role: 'system',
    content: `You are a professional bilingual telephone AI assistant speaking Russian and Thai.

The caller's current language is ${languageName}. Reply only in ${languageName} unless the caller switches language. If the caller switches between Russian and Thai, switch immediately and naturally on the next reply. Never translate the reply unless the caller asks.

Russian replies must be natural spoken Russian. Thai replies must be natural spoken Thai, using polite and conversational wording appropriate for a phone call.

Keep replies brief, usually one or two short sentences. Speak like a natural phone conversation, not a text chatbot.

Правила речи:
- Отвечай кратко, обычно 1–2 короткими предложениями.
- Говори так, как говорит живой человек по телефону, а не как текстовый чат-бот.
- Используй естественные разговорные фразы и лёгкие подтверждения, когда это уместно.
- Не используй длинные монологи, сложные конструкции и официальный письменный стиль.
- Задавай только один основной вопрос за раз.
- Не повторяй слова клиента без необходимости.
- Не повторяй вопрос, если клиент уже на него ответил.
- Учитывай контекст всего текущего разговора.
- Естественно адаптируйся к ответам, намерению и тону клиента.
- Не читай заранее подготовленный сценарий механически.
- Не используй маркированные списки, заголовки, Markdown или специальные символы в устном ответе.
- Используй пунктуацию естественно, чтобы голосовой синтез правильно передавал паузы и ритм.
- Избегай чрезмерного количества восклицательных знаков и неестественной эмоциональности.
- Если клиент перебивает или меняет тему, естественно отреагируй на последнее сказанное.
- Если клиент хочет закончить разговор, не удерживай его и заверши разговор естественно.

The caller's speech comes from telephone speech recognition and may contain errors. If the meaning is clear enough, respond to the meaning. If it is genuinely unclear, ask one short clarification question in the caller's current language.

Keep the conversation natural, brief, coherent, and suitable for speech synthesis. Do not use lists, headings, Markdown, or internal analysis.`
  },
  ...memory,
  { role: 'user', content: userText }
];
    

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ===============================
// 🔊 ELEVENLABS TTS — версия для телефона (mulaw 8000Hz)
// ===============================
async function textToSpeechForCall(text, language) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=ulaw_8000&language_code=${language}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.35,
        similarity_boost: 0.80,
        style: 0.25,
        use_speaker_boost: true
      }
    })
    }
  );  

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ===============================
// 📝 AUTOMATIC CALL SUMMARY
// ===============================
async function generateCallSummary(callSid) {
  const memory = conversationMemory.get(callSid) || [];

  if (memory.length === 0) {
    console.log('ℹ️ Нет диалога для создания сводки');
    return null;
  }

  const transcript = memory
    .map((message) => {
      const speaker = message.role === 'user' ? 'Customer' : 'AI';
      return `${speaker}: ${message.content}`;
    })
    .join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You analyze phone conversations between a Russian-speaking customer and an AI voice agent.

Return valid JSON only with exactly these fields:
{
  "customer_name": "Customer's name if mentioned during the call, otherwise null",
  "language": "Russian",
  "outcome": "interested | not_interested | callback_requested | needs_follow_up | completed | unclear",
  "summary": "Краткое резюме разговора на русском языке",
  "customer_intent": "Что хотел клиент, на русском языке",
  "key_points": ["Важный момент 1 на русском", "Важный момент 2 на русском"],
  "follow_up_needed": true,
  "next_action": "Рекомендуемое следующее действие, на русском языке"
}

The "outcome" field must stay in English exactly as one of the listed enum values (it is used by other code). All other text fields (summary, customer_intent, key_points, next_action) must be written in Russian.
Be accurate. Do not invent information that was not present in the conversation.`
        },
        {
          role: 'user',
          content: `Analyze and summarize this phone conversation:\n\n${transcript}`
        }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `OpenAI summary API error: ${response.status} ${errText}`
    );
  }

  const data = await response.json();
  const summaryText = data.choices[0].message.content;
  const summary = JSON.parse(summaryText);

  console.log('\n================================');
  console.log('📝 CALL SUMMARY');
  console.log('================================');
  console.log('📞 Call SID:', callSid);
  console.log(JSON.stringify(summary, null, 2));
  console.log('================================\n');

  return summary;
}

// ===============================
// 🧮 SUMMARY HELPERS
// ===============================
async function translateToThai(transcript) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Translate the full phone conversation from Russian to natural Thai. Preserve speaker labels, meaning, and line breaks. Return only the Thai translation.'
        },
        { role: 'user', content: transcript }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI Thai translation API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

function formatDurationThai(seconds) {
  if (seconds === null || seconds === undefined) return 'ไม่ทราบ';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} วินาที`;
  return `${m} นาที ${s} วินาที`;
}

function formatDurationRu(seconds) {
  if (seconds === null || seconds === undefined) return 'неизвестно';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;

  const minWord = pluralRu(m, 'минута', 'минуты', 'минут');
  const secWord = pluralRu(s, 'секунда', 'секунды', 'секунд');

  if (m === 0) return `${s} ${secWord}`;
  return `${m} ${minWord} ${s} ${secWord}`;
}

// Простое склонение русских слов по числу (1 минута, 2 минуты, 5 минут...)
function pluralRu(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return few;
  return many;
}

const OUTCOME_LABELS_TH = {
  interested: 'สนใจบริการ',
  not_interested: 'ไม่สนใจบริการ',
  callback_requested: 'ขอให้โทรกลับ',
  needs_follow_up: 'ต้องติดตามเพิ่มเติม',
  completed: 'จบการสนทนาเรียบร้อย',
  unclear: 'ไม่ชัดเจน'
};

const OUTCOME_LABELS_RU = {
  interested: 'Клиент заинтересован',
  not_interested: 'Клиент не заинтересован',
  callback_requested: 'Просьба перезвонить',
  needs_follow_up: 'Требуется дальнейшее сопровождение',
  completed: 'Разговор завершён',
  unclear: 'Не ясно'
};

function buildSummaryPayload(callSid, summary) {
  const meta = callMetadata.get(callSid) || {};
  const durationSeconds = meta.startedAt
    ? Math.round((Date.now() - meta.startedAt) / 1000)
    : null;

  return {
    callSid,
    from: meta.from || null,
    to: meta.to || null,
    startedAt: meta.startedAt ? new Date(meta.startedAt).toISOString() : null,
    endedAt: new Date().toISOString(),
    durationSeconds,
    ...summary
  };
}

// ===============================
// 📤 SEND CALL SUMMARY TO EXTERNAL WEBHOOK
// ===============================
async function sendCallSummaryWebhook(payload) {
  const webhookUrl = process.env.SUMMARY_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log('ℹ️ SUMMARY_WEBHOOK_URL не задан — пропускаем отправку вебхука');
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Webhook responded ${response.status}: ${errText}`);
    }

    console.log('✅ Сводка отправлена на вебхук:', webhookUrl);
  } catch (err) {
    // Ошибка вебхука не должна ломать завершение звонка
    console.error('❌ Ошибка отправки сводки на вебхук:', err);
  }
}

// ===============================
// 📤 SEND CALL SUMMARY TO TELEGRAM
// ===============================
async function sendTelegramSummary(payload) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.log('ℹ️ TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID не заданы — пропускаем отправку в Telegram');
    return;
  }

  const outcomeLabel = OUTCOME_LABELS_RU[payload.outcome] || payload.outcome || 'неизвестно';
  const customerName = payload.customer_name || 'имя не указано';
  const followUp = payload.follow_up_needed ? 'Да' : 'Нет';
  const keyPoints = Array.isArray(payload.key_points) && payload.key_points.length > 0
    ? payload.key_points.map((p) => `• ${p}`).join('\n')
    : null;

  const lines = [
    '📞 Сводка звонка',
    `👤 Клиент: ${customerName}`,
    `🌍 Язык: ${payload.language || 'Russian'}`,
    `⏱️ Длительность звонка: ${formatDurationRu(payload.durationSeconds)}`,
    `🎯 Результат: ${outcomeLabel}`,
    `📝 Резюме: ${payload.summary || '-'}`,
    keyPoints ? `📌 Ключевые моменты:\n${keyPoints}` : null,
    `🔄 Требуется дальнейшее сопровождение: ${followUp}`,
    `✅ Следующий шаг: ${payload.next_action || '-'}`
  ].filter(Boolean);

  const text = [
    '📞 CALL SUMMARY',
    '',
    '🇷🇺 Russian Transcript',
    payload.transcript || '-',
    '',
    '────────────────',
    '',
    '🇹🇭 Thai Translation',
    payload.thaiTranslation || '-',
    '',
    '────────────────',
    '',
    '📋 Summary',
    payload.summary || '-',
    '',
    '🎯 Customer Intent',
    payload.customer_intent || '-',
    '',
    '📌 Next Action',
    payload.next_action || '-'
  ].join('\n');

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Telegram API responded ${response.status}: ${errText}`);
    }

    console.log('✅ Сводка отправлена в Telegram');
  } catch (err) {
    // Ошибка Telegram не должна ломать завершение звонка
    console.error('❌ Ошибка отправки сводки в Telegram:', err);
  }
}

// ===============================
// 🛑 FINALIZE CALL SAFELY
// ===============================
async function finalizeCall(callSid) {
  if (!callSid) {
    return;
  }

  // 'stop' и 'close' могут вызвать finalizeCall для одного и того же звонка
  // почти одновременно — не даём сводке/вебхуку/Telegram уйти дважды.
  if (callFinalizationPromises.has(callSid)) {
    console.log('ℹ️ Финализация звонка уже выполняется/выполнена, пропускаем повтор:', callSid);
    return callFinalizationPromises.get(callSid);
  }

  const promise = finalizeCallOnce(callSid).finally(() => {
    callFinalizationPromises.delete(callSid);
  });

  callFinalizationPromises.set(callSid, promise);
  return promise;
}

async function finalizeCallOnce(callSid) {
  const memory = conversationMemory.get(callSid);

  if (!memory || memory.length === 0) {
    conversationMemory.delete(callSid);
    callMetadata.delete(callSid);
    callLanguages.delete(callSid);
    return;
  }

  const transcript = memory
    .map((message) => {
      const speaker = message.role === 'user' ? 'Customer' : 'AI';
      return `${speaker}: ${message.content}`;
    })
    .join('\n');

  try {
    console.log('📝 Создание сводки звонка...');
    const summary = await generateCallSummary(callSid);
    console.log('✅ Сводка звонка создана');

    if (summary) {
      let thaiTranslation = '-';
      try {
        thaiTranslation = await translateToThai(transcript);
      } catch (err) {
        console.error('Thai transcript translation failed:', err);
      }

      const payload = {
        ...buildSummaryPayload(callSid, summary),
        transcript,
        thaiTranslation
      };
      await sendCallSummaryWebhook(payload);
      await sendTelegramSummary(payload);
    }
  } catch (err) {
    console.error('❌ Ошибка создания сводки звонка:', err);
  } finally {
    conversationMemory.delete(callSid);
    callMetadata.delete(callSid);
    callLanguages.delete(callSid);
  }
}

// ===============================
// 🎧 WEBSOCKET — приём аудио звонка от Twilio в реальном времени
// ===============================
wss.on('connection', (twilioWs, request) => {
  console.log('📡 Twilio Media Stream connected', {
    path: request.url,
    host: request.headers.host
  });

  let streamSid;
  let callSid;
  let deepgramWs;
  let deepgramReady = false;
  let pendingAudioChunks = [];
  let streamFinalized = false;
  let transcriptFlushTimer;
  let pendingTranscriptParts = [];
  let isProcessingTranscript = false;
  const TRANSCRIPT_DEBOUNCE_MS = 1200;

  function scheduleTranscriptFlush() {
    clearTimeout(transcriptFlushTimer);
    transcriptFlushTimer = setTimeout(() => {
      flushTranscript().catch((err) => {
        console.error('❌ Ошибка обработки речи:', err);
      });
    }, TRANSCRIPT_DEBOUNCE_MS);
  }

  async function flushTranscript() {
    if (isProcessingTranscript || pendingTranscriptParts.length === 0) {
      return;
    }

    const combinedTranscript = pendingTranscriptParts.join(' ').replace(/\s+/g, ' ').trim();
    pendingTranscriptParts = [];

    if (!combinedTranscript) {
      return;
    }

    isProcessingTranscript = true;

    console.log('🧩 Объединённая реплика:', combinedTranscript);
    try {
      await handleUserSpeech(combinedTranscript, twilioWs, streamSid, callSid);
    } finally {
      isProcessingTranscript = false;
      if (pendingTranscriptParts.length > 0) {
        scheduleTranscriptFlush();
      }
    }
  }
  function startDeepgram() {
    if (deepgramWs) {
      return;
    }

    deepgramWs = new WebSocket(
      'wss://api.deepgram.com/v1/listen?model=nova-2&language=multi&smart_format=true&encoding=mulaw&sample_rate=8000&endpointing=1200',
      { headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` } }
    );

    deepgramWs.on('open', () => {
      deepgramReady = true;
      console.log('✅ Deepgram WebSocket connected', { callSid, streamSid });

      for (const audioChunk of pendingAudioChunks) {
        deepgramWs.send(audioChunk);
      }
      pendingAudioChunks = [];
    });

    deepgramWs.on('error', (err) => {
      console.error('❌ Deepgram WebSocket error:', err.message);
    });

    deepgramWs.on('close', (code, reason) => {
      deepgramReady = false;
      console.log('🔴 Deepgram WebSocket closed', {
        callSid,
        code,
        reason: reason.toString()
      });
    });

    deepgramWs.on('message', async (msg) => {
  try {
    const raw = msg.toString();
    const data = JSON.parse(raw);

    // แสดงประเภท response ที่ Deepgram ส่งกลับมา
    console.log(
      '📥 Deepgram response:',
      data.type || 'unknown',
      '| is_final:',
      data.is_final,
      '| speech_final:',
      data.speech_final
    );

    // ถ้า Deepgram ส่ง error กลับมา ให้เห็นทันที
    if (data.type === 'Error' || data.error) {
      console.error('❌ Deepgram response error:', data);
      return;
    }

    const transcript =
      data.channel?.alternatives?.[0]?.transcript?.trim() || '';

    if (transcript.length > 0) {
      console.log(
        '📝 Transcript received:',
        transcript,
        '| final:',
        data.is_final
      );
    }

    // ใช้เฉพาะ final transcript เหมือน logic เดิม
    if (transcript && data.is_final === true) {
      console.log('🗣️ Speech received:', transcript);

      pendingTranscriptParts.push(transcript); 
      scheduleTranscriptFlush();
    }
  } catch (error) {
    console.error('❌ Deepgram message processing error:', error);
    console.error('Raw Deepgram message:', msg.toString());
  }
    });
  }

  function finalizeMediaStream() {
    if (streamFinalized) {
      return;
    }

    streamFinalized = true;
    clearTimeout(transcriptFlushTimer);
    pendingAudioChunks = [];

    if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
      deepgramWs.close();
    }

    console.log('📋 Finalizing call', { callSid, streamSid });
    finalizeCall(callSid).catch((err) => {
      console.error('❌ Ошибка завершения звонка:', err);
    });
  }

  twilioWs.on('message', (message) => {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch (error) {
      console.error('❌ Invalid Twilio Media Stream message:', error.message);
      return;
    }

    if (msg.event === 'start') {
      streamSid = msg.start.streamSid;
      callSid = msg.start.callSid;
      console.log('▶️ Twilio Media Stream started', { streamSid, callSid });

      if (callSid) {
        conversationMemory.set(callSid, []);
        callLanguages.delete(callSid);
      }

      startDeepgram();
    }

    if (msg.event === 'media') {
  try {
    const audioChunk = Buffer.from(msg.media.payload, 'base64');

   

    if (deepgramReady && deepgramWs.readyState === WebSocket.OPEN) {
      deepgramWs.send(audioChunk);
    } else if (deepgramWs && pendingAudioChunks.length < 50) {
      pendingAudioChunks.push(audioChunk);
    } else {
      console.error(
        '❌ Cannot send audio to Deepgram. WebSocket state:',
        deepgramWs ? deepgramWs.readyState : 'not_started'
      );
    }
  } catch (error) {
    console.error('❌ Error processing Twilio audio:', error);
  }
}

    if (msg.event === 'stop') {
  clearTimeout(transcriptFlushTimer);
  console.log('⏹️ Twilio Media Stream stopped', {
    timestamp: new Date().toISOString(),
    streamSid: msg.stop?.streamSid || streamSid || null,
    callSid: msg.stop?.callSid || callSid || null,
    stopPayload: msg
  });
  finalizeMediaStream();
}
  });

  twilioWs.on('close', (code, reason) => {
  console.log('📴 Twilio Media Stream closed', {
    timestamp: new Date().toISOString(),
    streamSid: streamSid || null,
    callSid: callSid || null,
    code,
    reason: reason.toString()
  });
  finalizeMediaStream();
});

  twilioWs.on('error', (error) => {
    console.error('❌ Twilio Media Stream error:', error.message);
  });
});
// ===============================
// 🔁 Обработка реплики: LLM -> TTS -> отправка обратно в звонок
// ===============================
async function handleUserSpeech(userText, twilioWs, streamSid, callSid) {
  try {
    const language = detectCallerLanguage(
      userText,
      callLanguages.get(callSid) || 'ru'
    );
    callLanguages.set(callSid, language);

    const aiText = await getLLMResponse(userText, callSid, language);
    console.log('🤖 ИИ отвечает:', aiText);

    if (callSid) {
      const memory = conversationMemory.get(callSid);
      if (memory) {
        memory.push({ role: 'user', content: userText });
        memory.push({ role: 'assistant', content: aiText });
      }
    }

    const audioBuffer = await textToSpeechForCall(aiText, language);
    const audioBase64 = audioBuffer.toString('base64');

    twilioWs.send(JSON.stringify({
      event: 'media',
      streamSid: streamSid,
      media: { payload: audioBase64 }
    }));

    console.log('🔊 Ответ отправлен в звонок');
  } catch (err) {
    console.error('❌ Ошибка обработки речи:', err);
  }
}
// ===============================
// 📤 OUTBOUND CALL — โทรออกหนึ่งเบอร์
// ===============================
app.post('/call', async (req, res) => {
  try {
    const { to } = req.body;
    console.log('📞 POST /call received', { to: to || null });

    if (!to) {
      return res.status(400).json({
        success: false,
        error: 'Missing phone number in "to"'
      });
    }

    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const publicUrl = process.env.PUBLIC_URL?.replace(/\/+$/, '');

    if (!publicUrl) {
      return res.status(500).json({
        success: false,
        error: 'Missing PUBLIC_URL in .env'
      });
    }

    const call = await client.calls.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER,
    url: `${publicUrl}/voice`,
    method: 'POST',
    record: true
});
    console.log('📤 Outbound call created', {
      callSid: call.sid,
      voiceWebhook: `${publicUrl}/voice`
    });

    res.json({
      success: true,
      callSid: call.sid
    });
  } catch (err) {
    console.error('❌ Ошибка исходящего звонка:', err);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});


// ===============================
// 🚀 START
// ===============================
const PORT = Number(process.env.PORT || 3000);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`📞 Twilio Voice Server запущен на порту ${PORT}`);
  console.log(`🔗 Webhook endpoint: /voice`);
  console.log(`🎧 Media stream endpoint: /media`);
  console.log(`✅ Server is running and waiting for calls...`);
});

server.on('error', (error) => {
  console.error('❌ SERVER ERROR:', error);
});

process.on('SIGINT', () => {
  console.log('🛑 Server stopped');
  server.close();
});

process.on('SIGTERM', () => {
  console.log('🛑 Server stopping');
  server.close();
});

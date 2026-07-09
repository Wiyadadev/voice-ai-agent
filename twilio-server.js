require('dotenv').config();

const express = require('express');
const twilio = require('twilio');

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

async function getLLMResponse(userText) {
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
          content: `
Ты профессиональный русскоязычный голосовой AI-ассистент.
Всегда отвечай естественно, вежливо и только на русском языке.
Отвечай кратко и понятно, потому что твой ответ будет воспроизводиться по телефону.
`
        },
        {
          role: 'user',
          content: userText
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}


// รับสายและฟังเสียงผู้โทร
app.post('/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  const gather = twiml.gather({
    input: 'speech',
    language: 'ru-RU',
    speechTimeout: 'auto',
    action: '/process-speech',
    method: 'POST'
  });

  gather.say(
    {
      language: 'ru-RU'
    },
    'Здравствуйте! Чем я могу вам помочь?'
  );

  twiml.redirect('/voice');

  res.type('text/xml');
  res.send(twiml.toString());
});


// รับข้อความที่ Twilio ฟังได้ แล้วส่งให้ AI
app.post('/process-speech', async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  try {
    const userText = req.body.SpeechResult;

    console.log('🎤 Пользователь сказал:');
    console.log(userText);

    if (!userText) {
      twiml.say(
        { language: 'ru-RU' },
        'Извините, я вас не расслышал.'
      );

      twiml.redirect('/voice');

      res.type('text/xml');
      return res.send(twiml.toString());
    }

    console.log('🤖 AI обрабатывает запрос...');

    const aiText = await getLLMResponse(userText);

    console.log('🇷🇺 Ответ AI:');
    console.log(aiText);

    twiml.say(
      {
        language: 'ru-RU'
      },
      aiText
    );

    twiml.redirect('/voice');

  } catch (error) {
    console.error('❌ ERROR:', error);

    twiml.say(
      { language: 'ru-RU' },
      'Извините, произошла ошибка. Попробуйте еще раз.'
    );
  }

  res.type('text/xml');
  res.send(twiml.toString());
});


const PORT = 3000;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`📞 Twilio Voice Server запущен на порту ${PORT}`);
  console.log('🔗 Webhook endpoint: /voice');
  console.log('🤖 Russian AI conversation mode enabled');
  console.log('✅ Server is running and waiting for calls...');
});

server.on('error', (error) => {
  console.error('❌ SERVER ERROR:', error);
});
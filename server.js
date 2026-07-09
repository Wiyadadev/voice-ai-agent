require('dotenv').config();
const fs = require('fs');

// ===============================
// 🤖 AI RESPONSE
// ===============================
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
Твои ответы должны звучать хорошо при преобразовании текста в речь.
Будь дружелюбным, кратким и полезным.
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
    const errText = await response.text();
    throw new Error(
      `OpenAI API error: ${response.status} ${errText}`
    );
  }

  const data = await response.json();

  return data.choices[0].message.content;
}


// ===============================
// 🔊 ELEVENLABS TEXT TO SPEECH
// ===============================
async function textToSpeech(text, outputPath) {

  // ElevenLabs Voice ID
  const voiceId = 'nPczCjzI2devNBz1zQrb';

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
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
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    }
  );

  if (!response.ok) {
    const errText = await response.text();

    throw new Error(
      `ElevenLabs API error: ${response.status} ${errText}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  fs.writeFileSync(outputPath, buffer);

  console.log(`🔊 Аудио сохранено: ${outputPath}`);
}


// ===============================
// 🇷🇺 MAIN AI AGENT
// ===============================
async function main() {

  const userText = `
Здравствуйте!

Я хотел бы забронировать столик в ресторане на сегодняшний вечер.

Нас будет четыре человека, желательно столик возле окна.

Подскажите, пожалуйста, есть ли свободные места после восьми часов вечера?

Также я хотел бы узнать, какие блюда вы рекомендуете.

Один из гостей не ест мясо, поэтому нам нужны вегетарианские варианты.

Есть ли в вашем меню блюда без мяса и морепродуктов?

Если столик доступен, пожалуйста, забронируйте его на имя Александр.

Мой номер телефона можно использовать для подтверждения бронирования.

Спасибо большое!
`;


  console.log('\n==========================================');
  console.log('🇷🇺 ПОЛУЧЕН НОВЫЙ ЗАПРОС ПОЛЬЗОВАТЕЛЯ');
  console.log('==========================================\n');

  console.log(userText);


  console.log('\n==========================================');
  console.log(
    '🤖 ОБРАБОТКА ЗАПРОСА ИСКУССТВЕННЫМ ИНТЕЛЛЕКТОМ'
  );
  console.log('==========================================\n');


  const aiText = await getLLMResponse(userText);


  console.log('\n==========================================');
  console.log('✅ ОТВЕТ ИСКУССТВЕННОГО ИНТЕЛЛЕКТА');
  console.log('==========================================\n');

  console.log(aiText);


  console.log('\n==========================================');
  console.log(
    '🔊 ГЕНЕРАЦИЯ ГОЛОСОВОГО ОТВЕТА НА РУССКОМ ЯЗЫКЕ'
  );
  console.log('==========================================\n');


  await textToSpeech(aiText, 'output.mp3');


  console.log('\n==========================================');
  console.log('🎉 ГОЛОСОВОЙ ОТВЕТ УСПЕШНО СОЗДАН');
  console.log('==========================================\n');
}


// ===============================
// 🚀 START
// ===============================
main().catch(console.error);
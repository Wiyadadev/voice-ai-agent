require('dotenv').config();
const fetch = require('node-fetch');

async function listVoices() {
  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }
  });
  const data = await response.json();
  
  if (!response.ok) {
    console.log('Error:', data);
    return;
  }

  console.log(`พบเสียงทั้งหมด ${data.voices.length} เสียง:\n`);
  data.voices.forEach(v => {
    console.log(`ชื่อ: ${v.name} | ID: ${v.voice_id} | หมวด: ${v.category}`);
  });
}

listVoices();
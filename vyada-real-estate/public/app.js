// STT and TTS adapters can be replaced without changing call or lead logic.
export class BrowserSTT {
  constructor() { this.Type = window.SpeechRecognition || window.webkitSpeechRecognition; }
  listen() { return new Promise((resolve, reject) => { if (!this.Type) return reject(new Error('Speech recognition unavailable. Please type your reply.')); this.active = new this.Type(); this.active.lang = 'en-US'; this.active.interimResults = false; let heard = false; this.active.onresult = e => { heard = true; resolve(e.results[0][0].transcript); }; this.active.onerror = () => reject(new Error('Microphone unavailable or recognition failed. Please type your reply.')); this.active.onend = () => { if (!heard) reject(new Error('No speech heard. Try again or type.')); }; this.active.start(); }); }
  stop() { this.active?.abort(); }
}
export class BrowserTTS {
  speak(text) { this.stop(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'en-US'; window.speechSynthesis.speak(utterance); }
  stop() { window.speechSynthesis?.cancel(); }
}
const $ = id => document.getElementById(id);
let call, busy = false;
const stt = new BrowserSTT(), tts = new BrowserTTS();
async function api(path, body) { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); const data = await r.json(); if (!r.ok) throw new Error(data.error); return data; }
function controls() { const active = call?.status === 'active'; $('start').disabled = busy || (call && call.status !== 'ended'); $('end').disabled = busy || !call || call.status === 'ended'; for (const id of ['send','mic','text']) $(id).disabled = busy || !active; }
function message(text, user = false) { const p = document.createElement('p'); p.textContent = `${user ? 'You' : 'VYADA'}: ${text}`; if (user) p.className = 'user'; $('messages').append(p); p.scrollIntoView({ block: 'nearest' }); if (!user && $('speak').checked) tts.speak(text); }
function render(data) { call = data; $('lead').replaceChildren(); for (const [key,value] of Object.entries(data.lead)) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key.replaceAll('_',' '); dd.textContent = value; $('lead').append(dt,dd); } if (data.summary) { $('summary').textContent = data.summary; $('status').textContent = `Telegram: ${data.delivery.status}. ${data.delivery.detail || ''}`; } controls(); }
async function run(action) { if (busy) return; busy = true; controls(); $('status').textContent = ''; try { await action(); } catch (e) { $('status').textContent = e.message; } finally { busy = false; controls(); } }
$('start').onclick = () => run(async () => { tts.stop(); render(await api('/api/calls')); $('messages').replaceChildren(); $('summary').textContent = 'Your summary will appear here.'; message(call.reply); });
$('end').onclick = () => run(async () => { stt.stop(); tts.stop(); render(await api(`/api/calls/${call.id}/end`)); });
$('form').onsubmit = e => { e.preventDefault(); const text = $('text').value.trim(); if (!text) return; run(async () => { tts.stop(); const data = await api(`/api/calls/${call.id}/turn`, { text }); message(text,true); $('text').value = ''; render(data); message(data.reply); if (data.status === 'ready_to_end') render(await api(`/api/calls/${call.id}/end`)); }); };
$('mic').onclick = () => run(async () => { tts.stop(); $('status').textContent = 'Listening…'; $('text').value = await stt.listen(); $('status').textContent = 'Check the transcript, then send your reply.'; });
window.addEventListener('pagehide', () => { stt.stop(); tts.stop(); });

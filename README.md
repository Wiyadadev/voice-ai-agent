# ตัวแทนสนทนาด้วยเสียง (Voice AI Agent) ภาษาไทย/รัสเซีย

ระบบตัวแทนสนทนาทางโทรศัพท์ด้วยเสียงสำหรับใช้งานจริง สร้างขึ้นบน Twilio Media Streams รองรับการรู้จำเสียงพูดภาษาไทยและรัสเซียด้วย Deepgram สร้างคำตอบแบบกระชับในภาษาปัจจุบันของผู้โทรด้วย OpenAI สังเคราะห์เสียงสำหรับโทรศัพท์ด้วย ElevenLabs และส่งสรุปหลังการโทรพร้อมคำแปลภาษาไทยไปยัง Telegram รวมถึง webhook เสริม

## สถาปัตยกรรมระบบ

```text
สายเรียกเข้า Twilio
  -> POST /voice (TwiML คำทักทาย + wss://<host>/media)
  -> WebSocket /media
  -> Deepgram Nova-2 multilingual, mu-law 8 kHz
  -> ตรวจจับภาษาไทย/รัสเซียต่อประโยคที่ผู้โทรพูด
  -> OpenAI Chat Completions พร้อมหน่วยความจำบทสนทนาต่อสาย
  -> ElevenLabs multilingual TTS พร้อมระบุภาษา, mu-law 8 kHz
  -> ส่งเสียงกลับไปยัง Twilio stream

เมื่อสายจบ/ปิดการเชื่อมต่อ
  -> บันทึกการสนทนาภาษารัสเซียและสรุปโครงสร้างด้วย OpenAI
  -> แปลเป็นภาษาไทย
  -> ส่งข้อความไปยัง Telegram
  -> POST ไปยัง SUMMARY_WEBHOOK_URL (ถ้ามีการตั้งค่า)
```

จุดเริ่มต้นของระบบสำหรับใช้งานจริงคือ `twilio-server.js` ส่วน `agent-brain.js` จะโหลดกฎการสนทนาจาก `analysis/conversation_logic.json` สถานะการโทรระหว่างการทำงานจะถูกเก็บไว้ในหน่วยความจำตาม Call SID ดังนั้นหากรีสตาร์ทเซิร์ฟเวอร์ บทสนทนาที่กำลังดำเนินอยู่และสรุปที่ยังไม่เสร็จจะหายไป

## สถานะปัจจุบัน

ส่วนที่เสร็จสมบูรณ์และเชื่อมต่อใช้งานจริงแล้ว:

- Webhook รับสายเข้าของ Twilio และการสร้างสายโทรออก
- WebSocket สำหรับ media แบบสองทิศทางของ Twilio
- การรู้จำเสียงพูดภาษาไทยและรัสเซียด้วย Deepgram
- บทสนทนาภาษาไทย/รัสเซียกับ OpenAI พร้อมบริบทต่อสาย
- เสียงพูดแบบ mu-law ที่ใช้งานกับโทรศัพท์ได้จาก ElevenLabs
- การป้องกันการประมวลผล `stop`/`close` ซ้ำซ้อนเมื่อสายจบ
- การสรุปการโทรและแปลเป็นภาษาไทยด้วย OpenAI
- การส่งสรุปไปยัง Telegram
- Webhook สรุปผลเสริม (ไม่บังคับ)
- Endpoint `/health` สำหรับตรวจสอบสถานะการ deploy
- ตั้งค่า `PORT` ได้สำหรับแพลตฟอร์ม hosting

โปรเจกต์นี้ยังมีโฟลเดอร์ `vyada-real-estate/` ซึ่งเป็น sandbox ภาษาอังกฤษแยกต่างหาก มี package, server, UI และชุดทดสอบของตัวเอง **ไม่ได้ถูก import หรือใช้งานโดยตัวแทนสนทนา Twilio นี้**

## การตรวจจับและสลับภาษา

Deepgram ใช้โหมด multilingual streaming (`language=multi`) เพื่อไม่ให้ audio stream ถูกล็อกไว้ที่ภาษารัสเซียเพียงอย่างเดียว สำหรับแต่ละ final transcript เซิร์ฟเวอร์จะนับตัวอักษรไทยและตัวอักษรซีริลลิก (Cyrillic):

- หากตัวอักษรไทยมากกว่า: ถือว่าเป็นภาษาไทย (`th`)
- หากตัวอักษรซีริลลิกมากกว่า: ถือว่าเป็นภาษารัสเซีย (`ru`)
- หาก transcript ไม่มีทั้งสองสคริปต์: ใช้ภาษาก่อนหน้าของ Call SID นั้นต่อไป

ภาษาที่ตรวจพบจะถูกส่งไปยัง OpenAI เพื่อกำหนดภาษาที่ใช้ตอบ และส่งไปยัง ElevenLabs เป็น `language_code` กระบวนการนี้ทำงานแยกกันในทุกประโยค ทำให้ผู้โทรสามารถสลับระหว่างภาษาไทยและรัสเซียได้ระหว่างการโทรครั้งเดียว โดยหน่วยความจำบทสนทนายังคงใช้ร่วมกัน รักษาบริบทไว้แม้มีการสลับภาษา

## ตัวแปรสภาพแวดล้อมที่จำเป็น

ตั้งค่าเป็นไฟล์ `.env` ในเครื่อง หรือเป็น secret ของแพลตฟอร์ม deploy ห้าม commit ไฟล์ `.env` หรือใส่ค่า secret ไว้ใน README

จำเป็นสำหรับเซิร์ฟเวอร์ที่ใช้งานจริง:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`
- `DEEPGRAM_API_KEY`

จำเป็นสำหรับการโทรออก:

- `PUBLIC_URL` - URL สาธารณะแบบ HTTPS ของแอปพลิเคชันนี้ (ไม่มี `/` ต่อท้าย)

จำเป็นสำหรับการส่งสรุปไปยัง Telegram:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

ไม่บังคับ:

- `SUMMARY_WEBHOOK_URL`
- `PORT` - มักถูกกำหนดโดยแพลตฟอร์ม hosting เอง ค่าเริ่มต้นในเครื่องคือ `3000`

`dotenv` จะอ่านไฟล์ `.env` ในการพัฒนาบนเครื่อง ส่วนบน production ให้ตั้งค่าตัวแปรสภาพแวดล้อมในระบบจัดการ secret/environment ของ hosting provider แอปพลิเคชันนี้จะไม่พิมพ์ API key หรือส่วนหนึ่งส่วนใดของ token ออกมา

## การรันในเครื่อง (Local)

ข้อกำหนดเบื้องต้น: Node.js 18 ขึ้นไป และ HTTPS tunnel สาธารณะสำหรับทดสอบ Twilio callback จริง

```powershell
npm install
npm start
```

เซิร์ฟเวอร์จะฟังที่ `http://0.0.0.0:3000` โดยค่าเริ่มต้น สำหรับทดสอบ Twilio ในเครื่อง ให้รัน ngrok แยกต่างหาก แล้วตั้งค่า `PUBLIC_URL` เป็น URL แบบ HTTPS ของ ngrok จากนั้นตั้งค่า voice webhook ของหมายเลขโทรศัพท์ Twilio เป็น `POST <PUBLIC_URL>/voice`

คำสั่งตรวจสอบที่มีประโยชน์:

```powershell
npm run check
Invoke-WebRequest http://127.0.0.1:3000/health
```

สำหรับการสร้างสายโทรออก ให้ส่ง JSON request ไปที่ `POST /call` พร้อมหมายเลขโทรศัพท์ปลายทางในฟิลด์ `to` โดย request นี้จะใช้ `PUBLIC_URL/voice` เป็น TwiML URL

## การ Deploy แบบถาวร

1. Deploy repository ไปยังบริการ Node.js 18+ ที่รองรับการเชื่อมต่อ HTTP และ WebSocket ระยะยาว
2. ตั้งค่า start command เป็น `npm start` (หรือ `npm run start:production`)
3. เพิ่มตัวแปรสภาพแวดล้อมที่จำเป็นทั้งหมดใน secret manager ของแพลตฟอร์ม ห้ามอัปโหลดไฟล์ `.env`
4. ให้แพลตฟอร์มเป็นผู้กำหนดค่า `PORT` เอง เซิร์ฟเวอร์จะ bind กับ `0.0.0.0`
5. ตั้งค่า `PUBLIC_URL` เป็น URL บริการสาธารณะแบบ HTTPS ที่มั่นคง
6. ใน Twilio ให้ตั้งค่า incoming voice webhook ของหมายเลขโทรศัพท์เป็น `POST <PUBLIC_URL>/voice`
7. ตรวจสอบว่า `GET <PUBLIC_URL>/health` คืนค่า JSON ที่มี `status: "ok"`
8. ทดสอบโทรเข้าแบบควบคุมได้ จากนั้นตรวจสอบสรุปที่ส่งไปยัง Telegram และ webhook เสริม (ถ้ามี)
9. สำหรับสายโทรออก ให้เรียก `POST <PUBLIC_URL>/call` พร้อมหมายเลขปลายทาง แล้วตรวจสอบ caller ID ของ Twilio ที่ตั้งค่าไว้

ใช้ host ที่รองรับ WebSocket และมี process manager หรือ managed service ที่รีสตาร์ทโพรเซสอัตโนมัติเมื่อเกิดความล้มเหลว สถานะการโทรที่เก็บในหน่วยความจำปัจจุบันเหมาะสำหรับการรันบน instance เดียว หากต้องการขยายไปหลาย instance จะต้องมีการแชร์สถานะการโทร/เซสชันร่วมกันก่อน

## ขั้นตอนการโทรเข้าและโทรออก

### โทรเข้า (Inbound)

1. Twilio ส่ง `POST /voice`
2. เซิร์ฟเวอร์ส่งคำทักทายภาษารัสเซียแบบ TwiML กลับไป และเชื่อมต่อ Twilio เข้ากับ `/media`
3. เสียงจะถูกสตรีมไปยัง Deepgram
4. ประโยคสุดท้ายที่เป็นภาษาไทยหรือรัสเซียจะถูกจัดกลุ่ม ตรวจจับภาษา ส่งไปยัง OpenAI พร้อมหน่วยความจำของสายนั้น และแปลงเป็นเสียงโทรศัพท์โดย ElevenLabs ในภาษาเดียวกัน
5. เสียงจะถูกส่งกลับผ่าน Twilio stream
6. เมื่อ stream หยุดหรือปิด บทสนทนาจะถูกสรุป แปล และส่งออกไป

### โทรออก (Outbound)

1. ผู้โทรที่เชื่อถือได้ส่ง `POST /call` พร้อม `{ "to": "..." }`
2. เซิร์ฟเวอร์สร้างสาย Twilio โดยใช้ `TWILIO_PHONE_NUMBER` และ `PUBLIC_URL/voice`
3. Twilio เข้าสู่ขั้นตอน `/voice` และ `/media` เดียวกันกับสายเรียกเข้า

## รายการไฟล์ในโปรเจกต์

ไฟล์ที่ใช้งานจริงในระบบ production:

- `twilio-server.js` - HTTP routes, Twilio WebSocket, Deepgram, OpenAI, ElevenLabs, สรุปผล, แปลภาษา, Telegram
- `agent-brain.js` - การสร้าง prompt สำหรับบทสนทนา
- `analysis/conversation_logic.json` - กฎการสนทนาที่สร้างขึ้น
- `package.json` และ `package-lock.json` - Node runtime และ dependencies

ไฟล์สำหรับการวิจัยหรือบำรุงรักษา ไม่ใช่ dependency ของระบบ runtime:

- `analyze_transcripts.py`, `batch_transcribe.py`, `combine_analysis.py` - pipeline วิเคราะห์ transcript แบบ offline
- `call-data/` และ `analysis/individual/` - คลังข้อมูล transcript และผลวิเคราะห์ที่ใช้พัฒนา prompt
- `checkVoices.js` - เครื่องมือทดสอบแสดงรายการเสียงของ ElevenLabs (ใช้ครั้งเดียว)
- `Test telegram.js` - ไฟล์ทดสอบการส่งข้อความ Telegram (ใช้ครั้งเดียว) ไม่ได้ถูก import โดยเซิร์ฟเวอร์
- `process-record-url.txt` - ข้อมูล transcript/วิจัยต้นทาง
- `output.mp3` - ไฟล์เสียงที่สร้างขึ้นในเครื่อง

`server.js` เป็นโปรแกรมสาธิต OpenAI/ElevenLabs รุ่นก่อนหน้าแบบแยกเดี่ยว ไม่ได้ถูก import โดยเซิร์ฟเวอร์ production `vyada-real-estate/` เป็น sandbox ภาษาอังกฤษแบบแยกเดี่ยวและครบในตัวเอง ไฟล์เหล่านี้ยังคงถูกเก็บไว้เนื่องจากยังไม่ยืนยันว่าปลอดภัยที่จะลบ และอาจมีประโยชน์สำหรับการวิจัยหรือสาธิตต่อไป

## การตรวจสอบความถูกต้อง (Validation)

`npm run check` ใช้ตรวจสอบไวยากรณ์ JavaScript ของ production ส่วน sandbox ที่ซ้อนอยู่มีคำสั่งของตัวเองแยกต่างหากภายใต้ `vyada-real-estate/` และไม่ได้เป็นส่วนหนึ่งของคำสั่ง start ของ production

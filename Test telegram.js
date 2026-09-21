// ทดสอบส่ง Telegram แยกจากระบบโทร — รันด้วย: node test-telegram.js
require('dotenv').config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

console.log('== ค่าที่อ่านได้จาก .env ==');
console.log('TELEGRAM_BOT_TOKEN:', botToken ? `${botToken.slice(0, 6)}...${botToken.slice(-4)} (длина ${botToken.length})` : '❌ ไม่พบค่า (undefined)');
console.log('TELEGRAM_CHAT_ID:', chatId ? JSON.stringify(chatId) : '❌ ไม่พบค่า (undefined)');
console.log('');

if (!botToken || !chatId) {
  console.log('❌ ไม่พบ TELEGRAM_BOT_TOKEN หรือ TELEGRAM_CHAT_ID ใน .env — เช็คว่าไฟล์ .env อยู่โฟลเดอร์เดียวกับสคริปต์นี้ และไม่มี typo ในชื่อ key');
  process.exit(1);
}

(async () => {
  try {
    // 1) ตรวจว่า token ใช้ได้ และเป็นบอทตัวไหน
    const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const me = await meRes.json();
    console.log('== ผลจาก getMe (token ใช้ได้ไหม / เป็นบอทตัวไหน) ==');
    console.log(JSON.stringify(me, null, 2));
    console.log('');

    if (!me.ok) {
      console.log('❌ Token ใช้ไม่ได้ ตรวจสอบ TELEGRAM_BOT_TOKEN อีกครั้ง');
      return;
    }

    // 2) ลองส่งข้อความจริง
    const sendRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '✅ ทดสอบส่งข้อความจากสคริปต์ test-telegram.js' })
    });
    const sendData = await sendRes.json();

    console.log('== ผลจาก sendMessage ==');
    console.log(JSON.stringify(sendData, null, 2));

    if (sendData.ok) {
      console.log('\n✅ สำเร็จ! เช็คแชทบอทของคุณได้เลย');
    } else {
      console.log('\n❌ ส่งไม่สำเร็จ — ดู "description" ด้านบนเพื่อรู้สาเหตุ (เช่น chat not found = chat_id ผิด หรือยังไม่เคยทักบอทก่อน)');
    }
  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาดระหว่างทดสอบ:', err);
  }
})();                                                                                             
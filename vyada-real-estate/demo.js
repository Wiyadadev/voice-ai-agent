import { createInterface } from 'node:readline/promises';
import { CallService } from './core.js';
import { MockBrain, TelegramNotifier, configuredServiceOptions } from './providers.js';
const interactive = process.argv.includes('--interactive');
const service = new CallService(...(interactive ? configuredServiceOptions() : [new MockBrain(), new TelegramNotifier()]));
const call = service.start();
console.log(`VYADA: ${call.reply}`);
if (interactive) {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  console.log('Use fictional details. Type /end to finish, or skip for unknown answers.');
  try { while (true) { const text = await input.question('You: '); if (text === '/end') break; try { const result = await service.turn(call.id, text); console.log(`VYADA: ${result.reply}`); if (result.status === 'ready_to_end') break; } catch (e) { console.log(e.message); } } } finally { input.close(); }
} else {
  for (const text of ['rent', 'A villa', 'Bophut', 'THB 40,000–50,000 per month', '2 bedrooms', 'October 2026', '6 months', 'Pet friendly; pool preferred', 'Saturday afternoon']) {
    console.log(`Fictional caller: ${text}`); console.log(`VYADA: ${(await service.turn(call.id, text)).reply}`);
  }
}
const result = await service.end(call.id);
console.log(`\n${result.summary}\n\nTelegram: ${result.delivery.status}`);

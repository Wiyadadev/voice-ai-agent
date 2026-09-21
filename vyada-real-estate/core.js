import { randomUUID } from 'node:crypto';

export const questions = {
  intent: 'Are you looking to buy or rent?',
  property_type: 'What type of property would suit you?',
  location: 'Which location would you prefer?',
  budget: 'What budget feels comfortable, including currency and whether it is monthly or a purchase total?',
  bedrooms: 'How many bedrooms would you like?',
  timeline: 'When would you like to move in or buy?',
  lease_duration: 'How long would you like to rent for?',
  special_requirements: 'Any must-haves, such as pets, a pool, or accessibility needs?',
  viewing_availability: 'When would you be available for a viewing?'
};
export const fields = Object.keys(questions);
export const greeting = "Hi, welcome to VYADA! I'm your AI assistant for this sandbox call. Let's find out what home would suit you. Are you looking to buy or rent?";

// Store interface: create/get/delete. Replace this adapter later with an explicit,
// consent-based customer store; a call ID is deliberately not a customer identity.
export class MemoryStore {
  constructor() { this.calls = new Map(); }
  create() {
    for (const [id, call] of this.calls) if (Date.now() - call.updated > 3600000) this.calls.delete(id);
    if (this.calls.size >= 100) throw new Error('Sandbox capacity reached; delete an old call.');
    const call = { id: randomUUID(), updated: Date.now(), status: 'active', lead: Object.fromEntries(fields.map(f => [f, null])), history: [{ role: 'assistant', content: greeting }], skipped: [], vibe: 'Not assessed', pending: 'intent', busy: false };
    this.calls.set(call.id, call); return call;
  }
  get(id) { const c = this.calls.get(id); if (!c || Date.now() - c.updated > 3600000) { this.calls.delete(id); throw new Error('Call not found or expired'); } return c; }
  delete(id) { this.calls.delete(id); }
}

export function snapshot(c) {
  return { id: c.id, status: c.status, reply: c.history.at(-1).content, lead: Object.fromEntries(fields.map(f => [f, c.lead[f]?.value ?? 'Missing'])), evidence: c.lead, summary: c.summary, delivery: c.delivery };
}

export function nextField(c) { return fields.find(f => !c.lead[f] && !c.skipped.includes(f) && !(f === 'lease_duration' && c.lead.intent?.value === 'buy')); }

export function validateUpdates(updates, text) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new Error('Invalid extraction');
  const clean = {};
  for (const [key, item] of Object.entries(updates)) {
    if (!fields.includes(key)) continue;
    if (item === null) { clean[key] = null; continue; }
    // Values must be verbatim caller language, not model paraphrases or guesses.
    if (!item || typeof item.value !== 'string' || typeof item.evidence !== 'string' || !item.value.trim() || item.value.length > 200 || !text.includes(item.evidence) || !item.evidence.includes(item.value)) throw new Error('Ungrounded extraction');
    if (key === 'intent' && !['buy', 'rent'].includes(item.value)) throw new Error('Invalid intent');
    clean[key] = { value: item.value, evidence: item.evidence };
  }
  return clean;
}

export function summarize(c) {
  const present = f => Boolean(c.lead[f]);
  const essentials = ['intent', 'location', 'budget', 'timeline'];
  const complete = essentials.every(present);
  const qualification = complete && present('viewing_availability') ? 'High intent' : complete ? 'Medium intent' : 'Needs clarification';
  const missing = essentials.filter(f => !present(f));
  const next = missing.length ? `Clarify ${missing.join(', ')}.` : present('viewing_availability') ? 'Agent to review requirements and propose options; confirm viewing availability. No booking made.' : 'Agent to review requirements and ask about viewing availability.';
  return ['VYADA — SANDBOX LEAD', ...fields.map(f => `${f.replaceAll('_', ' ')}: ${c.lead[f]?.value ?? 'Missing'}`), `Customer vibe (inferred): ${c.vibe}`, `Lead: ${qualification} (based on stated requirements, not a sales prediction)`, `Next: ${next}`].join('\n');
}

export class CallService {
  constructor(brain, notifier, store = new MemoryStore()) { Object.assign(this, { brain, notifier, store }); }
  start() { return snapshot(this.store.create()); }
  async turn(id, text) {
    const c = this.store.get(id);
    if (c.status !== 'active' || c.busy) throw new Error('Call ended or busy');
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('Enter 1–2000 characters');
    if (c.history.length >= 121) throw new Error('Call limit reached; end this call');
    c.busy = true;
    try {
      const result = await this.brain.respond(c, text);
      const updates = validateUpdates(result.updates, text);
      if (typeof result.reply !== 'string' || !result.reply.trim() || result.reply.length > 800) throw new Error('Invalid reply');
      Object.assign(c.lead, updates);
      if (result.skip === true && c.pending) c.skipped.push(c.pending);
      if (['Friendly', 'Direct / concise', 'Concerned', 'Neutral'].includes(result.vibe)) c.vibe = result.vibe;
      c.history.push({ role: 'user', content: text }, { role: 'assistant', content: result.reply });
      c.pending = nextField(c); c.updated = Date.now();
      if (result.end === true) c.status = 'ready_to_end';
      return snapshot(c);
    } finally { c.busy = false; }
  }
  async end(id) {
    const c = this.store.get(id);
    if (c.finishing) return c.finishing;
    if (c.status === 'ended') return snapshot(c);
    if (c.busy) throw new Error('Call busy');
    c.status = 'ended'; c.summary = summarize(c); c.updated = Date.now();
    c.finishing = (async () => {
      try { c.delivery = await this.notifier.send(c.summary); }
      catch { c.delivery = { status: 'failed', detail: 'Telegram delivery failed or is uncertain; check the sandbox chat before resending manually.' }; }
      return snapshot(c);
    })();
    return c.finishing;
  }
}

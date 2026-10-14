// Telegram notifications + commands. Without a token it only logs to the console/file.
// Commands are accepted ONLY from TELEGRAM_CHAT_ID; messages from anyone else are ignored.
const API = 'https://api.telegram.org';
const MAX_LEN = 4000;

class Notifier {
  /** @param {{ token: string, chatId: string, log: (msg: string) => void, fetchImpl?: typeof fetch }} opts */
  constructor({ token, chatId, log, fetchImpl = fetch }) {
    this.token = token;
    this.chatId = String(chatId || '');
    this.log = log;
    this.fetch = fetchImpl;
    this.enabled = Boolean(token && chatId);
  }

  async call(method, body) {
    const res = await this.fetch(`${API}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(`Telegram ${method} failed: ${j.description || res.status}`);
    return j.result;
  }

  async send(text) {
    this.log(`[notify] ${text.replace(/\n/g, ' | ')}`);
    if (!this.enabled) return;
    try {
      await this.call('sendMessage', { chat_id: this.chatId, text: text.slice(0, MAX_LEN), disable_web_page_preview: true });
    } catch (err) {
      this.log(`[notify] Telegram send error: ${err.message}`);
    }
  }

  // Returns [{ command, args }] newer than `offset`, plus the next offset to store.
  async poll(offset) {
    if (!this.enabled) return { commands: [], offset };
    let updates;
    try {
      updates = await this.call('getUpdates', { offset, timeout: 0, allowed_updates: ['message'] });
    } catch (err) {
      this.log(`[notify] Telegram poll error: ${err.message}`);
      return { commands: [], offset };
    }
    const commands = [];
    let next = offset;
    for (const u of updates) {
      next = Math.max(next, u.update_id + 1);
      const msg = u.message;
      if (!msg || String(msg.chat?.id) !== this.chatId || typeof msg.text !== 'string') continue;
      const [cmd, ...args] = msg.text.trim().split(/\s+/);
      if (cmd.startsWith('/')) commands.push({ command: cmd.split('@')[0].toLowerCase(), args });
    }
    return { commands, offset: next };
  }
}

module.exports = { Notifier };

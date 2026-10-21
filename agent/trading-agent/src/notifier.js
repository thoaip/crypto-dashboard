// Telegram notifications + commands. Without a token it only logs to the console/file.
// Command authorization (SDL: least privilege, fail closed). A command runs only when ALL hold:
//  - it comes from TELEGRAM_CHAT_ID, and that chat is a private chat (group members cannot command the bot);
//  - the sender is in TELEGRAM_ALLOWED_USER_IDS when that list is set;
//  - it is recent (<= COMMAND_MAX_AGE_S): a /closeall typed while the agent was down is NOT replayed hours later;
//  - it is short and well-formed, and at most MAX_COMMANDS_PER_POLL are taken per poll.
// Everything else is dropped and only a redacted one-line note is logged.
const { redact } = require('./security');

const API = 'https://api.telegram.org';
const MAX_LEN = 4000;
const COMMAND_MAX_AGE_S = 600;
const MAX_COMMANDS_PER_POLL = 5;
const MAX_COMMAND_TEXT = 64;
const COMMAND_RE = /^\/[a-z_]{1,32}(?:@[A-Za-z0-9_]{1,64})?(?:\s+[A-Za-z0-9_]{1,16}){0,3}$/;

class Notifier {
  /**
   * @param {{ token: string, chatId: string, allowedUserIds?: string[], log: (msg: string) => void,
   *           fetchImpl?: typeof fetch, now?: () => number }} opts
   */
  constructor({ token, chatId, allowedUserIds = [], log, fetchImpl = fetch, now = () => Date.now() }) {
    this.token = token;
    this.chatId = String(chatId || '');
    this.allowedUserIds = new Set(allowedUserIds.map(String));
    this.log = log;
    this.fetch = fetchImpl;
    this.now = now;
    this.enabled = Boolean(token && chatId);
  }

  async call(method, body) {
    let res;
    try {
      res = await this.fetch(`${API}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      // Network errors can carry the request URL, which contains the bot token.
      throw new Error(`Telegram ${method} request failed: ${redact(err.message)}`);
    }
    const j = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
    if (!j.ok) throw new Error(`Telegram ${method} failed: ${redact(j.description || res.status)}`);
    return j.result;
  }

  async send(text) {
    const safe = redact(text);
    this.log(`[notify] ${safe.replace(/\n/g, ' | ')}`);
    if (!this.enabled) return;
    try {
      // Plain text only (no parse_mode): nothing in a message can be interpreted as markup or links.
      await this.call('sendMessage', { chat_id: this.chatId, text: safe.slice(0, MAX_LEN), disable_web_page_preview: true });
    } catch (err) {
      this.log(`[notify] Telegram send error: ${redact(err.message)}`);
    }
  }

  // Why a message is not accepted as a command (null = accepted).
  rejectReason(msg) {
    if (!msg || typeof msg.text !== 'string' || !msg.text.startsWith('/')) return 'not a command';
    if (String(msg.chat?.id) !== this.chatId) return 'wrong chat';
    if (msg.chat?.type !== 'private') return 'not a private chat';
    if (this.allowedUserIds.size && !this.allowedUserIds.has(String(msg.from?.id))) return 'sender not allowed';
    if (!Number.isFinite(msg.date) || this.now() / 1000 - msg.date > COMMAND_MAX_AGE_S) return 'too old';
    const text = msg.text.trim();
    if (text.length > MAX_COMMAND_TEXT || !COMMAND_RE.test(text)) return 'malformed';
    return null;
  }

  // Returns [{ command, args }] newer than `offset`, plus the next offset to store.
  async poll(offset) {
    if (!this.enabled) return { commands: [], offset };
    let updates;
    try {
      updates = await this.call('getUpdates', { offset, timeout: 0, allowed_updates: ['message'] });
    } catch (err) {
      this.log(`[notify] Telegram poll error: ${redact(err.message)}`);
      return { commands: [], offset };
    }
    const commands = [];
    let next = offset;
    for (const u of Array.isArray(updates) ? updates : []) {
      if (Number.isInteger(u.update_id)) next = Math.max(next, u.update_id + 1);
      const msg = u.message;
      const why = this.rejectReason(msg);
      if (why) {
        if (why !== 'not a command') this.log(`[notify] ignored Telegram message (${why}) from chat ${redact(msg?.chat?.id)}`);
        continue;
      }
      if (commands.length >= MAX_COMMANDS_PER_POLL) { this.log('[notify] too many commands in one poll - extra ignored'); continue; }
      const [cmd, ...args] = msg.text.trim().split(/\s+/);
      commands.push({ command: cmd.split('@')[0].toLowerCase(), args });
    }
    return { commands, offset: next };
  }
}

module.exports = { Notifier, COMMAND_MAX_AGE_S, MAX_COMMANDS_PER_POLL };

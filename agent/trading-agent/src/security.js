// Security helpers shared by every module (SDL: secrets never leave the process in clear text).
//  - redact(): applied to every log line, error text and outgoing Telegram message.
//  - Known secret VALUES are registered once at startup; generic patterns catch the rest
//    (signed query strings, Telegram bot tokens, Anthropic / Binance style keys).
const MIN_SECRET_LEN = 8;
const secrets = new Set();

const PATTERNS = [
  [/\?[^\s"']*/g, '?…'],                                  // query strings: Binance signature, timestamp, recvWindow
  [/(?<!\d)\d{6,12}:[A-Za-z0-9_-]{30,}/g, '<telegram-token>'], // Telegram bot token, also glued to "bot" in api.telegram.org/bot<token>/
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, '<anthropic-key>'],
  [/\b(api[_-]?key|secret|signature|token)(["'\s:=]+)[^\s"',&]{8,}/gi, '$1$2<redacted>'],
];

/** Register secret values (API keys, tokens) so redact() removes them wherever they appear. */
function registerSecrets(values) {
  for (const v of values) if (typeof v === 'string' && v.length >= MIN_SECRET_LEN) secrets.add(v);
}

function redact(text) {
  let s = String(text ?? '');
  for (const v of secrets) s = s.split(v).join('<redacted>');
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  return s;
}

/** Error text safe to show in Telegram / logs: redacted and length-bounded. */
const cleanErr = (err, max = 300) => redact(err?.message ?? err).slice(0, max);

// Test hook: forget registered secrets.
const _resetSecrets = () => secrets.clear();

module.exports = { registerSecrets, redact, cleanErr, _resetSecrets };

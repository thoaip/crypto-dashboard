// Claude commentary on each signal. Advisory only: it never changes what the agent trades.
// Any failure (no key, network, refusal) returns null and trading continues unaffected.
const sdk = require('@anthropic-ai/sdk');

const Anthropic = sdk.default ?? sdk;

const SYSTEM = `Bạn là trợ lý phân tích cho một bot giao dịch crypto chạy theo luật cố định (chỉ báo "Waves Trend Toolkit [CR] v2.3.0", spot, chỉ mua).
Bot ĐÃ quyết định xong theo luật; bạn chỉ viết nhận xét ngắn để người dùng hiểu bối cảnh. Không đổi quyết định, không hứa lợi nhuận, không khuyên tăng vốn.
Viết tiếng Việt, văn bản thuần (không markdown), tối đa 110 chữ, gồm:
1) Tín hiệu và bối cảnh: đồng thuận hay ngược với các khung lớn.
2) Rủi ro chính: ví dụ giá xa EMA200, ngược xu hướng khung lớn, khung có kết quả backtest yếu.
3) Mức làm tín hiệu sai: mức stop / điều kiện thoát.
Chỉ dùng số liệu được cung cấp; nếu thiếu dữ liệu thì nói rõ là thiếu.`;

class Commentator {
  /** @param {{ enabled: boolean, model: string, effort: string, keySet: boolean, log: (m: string) => void, client?: any }} opts */
  constructor({ enabled, model, effort, keySet, log, client }) {
    this.enabled = enabled && (keySet || Boolean(client));
    this.model = model;
    this.effort = effort;
    this.log = log;
    // Short timeout: commentary must not delay stop/TP checks of other symbols.
    this.client = this.enabled ? client ?? new Anthropic({ timeout: 20_000, maxRetries: 1 }) : null;
  }

  async comment(context) {
    if (!this.enabled) return null;
    try {
      const response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default', // re-run on a fallback model if this one declines
        output_config: { effort: this.effort },
        system: SYSTEM,
        messages: [{ role: 'user', content: `Dữ liệu tín hiệu (JSON):\n${JSON.stringify(context, null, 1)}` }],
      });
      if (response.stop_reason === 'refusal') {
        this.log(`[ai] declined (${response.stop_details?.category ?? 'no category'})`);
        return null;
      }
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      return text || null;
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) this.log('[ai] invalid ANTHROPIC_API_KEY - commentary disabled for this run');
      else if (err instanceof Anthropic.RateLimitError) this.log('[ai] rate limited - skipping commentary');
      else if (err instanceof Anthropic.APIError) this.log(`[ai] API error ${err.status}: ${err.message}`);
      else this.log(`[ai] error: ${err.message}`);
      if (err instanceof Anthropic.AuthenticationError) this.enabled = false;
      return null;
    }
  }
}

module.exports = { Commentator, SYSTEM };

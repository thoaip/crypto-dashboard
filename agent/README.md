# WTT paper agent (GitHub Actions)

Paper-trading agent for **Waves Trend Toolkit [CR] v2.3.0**, run by `.github/workflows/wtt-agent.yml` every 15 minutes.
Paper money only: this workflow never receives exchange API keys and always runs with `MODE=paper`.

- Code: `trading-agent/src` (same engine as the backtest: `backtest/engine.cjs`)
- Settings: `trading-agent/config.json` (coins, timeframe, size per trade, limits)
- State and trade log: branch `agent-state` (`state-paper.json`, `trades-paper.jsonl`)
- Results page: https://thoaip.github.io/crypto-dashboard/wtt/ (section "Paper trading")

Optional repository secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (notifications + /status, /stop, /resume),
`ANTHROPIC_API_KEY` (Claude commentary on each signal). Without them the agent still trades on paper silently.

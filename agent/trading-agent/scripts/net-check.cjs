// Network diagnostic: can this Node process reach Binance's public market-data API over TLS?
// Prints the underlying cause (e.g. SELF_SIGNED_CERT_IN_CHAIN when an antivirus intercepts HTTPS).
const URL_ = 'https://data-api.binance.vision/api/v3/ping';
fetch(URL_, { signal: AbortSignal.timeout(10000) })
  .then(r => console.log(`OK ${r.status} ${URL_}`))
  .catch(e => console.log(`FAIL ${URL_}: ${e.message} | cause: ${e.cause?.code || ''} ${e.cause?.message || ''}`));

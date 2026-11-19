export async function fetchJobFeedJson(url: URL, headers?: Record<string, string>) {
  const response = await fetch(url, {
    redirect: 'error', signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json', ...headers },
  });
  if (!response.ok || !response.body) throw new Error('Job provider unavailable');

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let json = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 3_000_000) throw new Error('Job provider response too large');
      json += decoder.decode(value, { stream: true });
    }
    return JSON.parse(json + decoder.decode()) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

import { Injectable, Logger } from '@nestjs/common';

/**
 * Thin LLM provider over the Anthropic Messages API (native fetch — no SDK).
 * Keyed by env: ANTHROPIC_API_KEY (or LLM_API_KEY). Model via LLM_MODEL.
 * When no key is set, `isConfigured()` is false and callers fall back to their
 * deterministic path — nothing breaks; the intelligence simply activates the
 * moment a key is provided.
 */
@Injectable()
export class LlmService {
  private readonly log = new Logger('LLM');
  private readonly key = process.env.ANTHROPIC_API_KEY || process.env.LLM_API_KEY || '';
  private readonly model = process.env.LLM_MODEL || 'claude-sonnet-4-6';
  private readonly endpoint = process.env.LLM_ENDPOINT || 'https://api.anthropic.com/v1/messages';

  isConfigured(): boolean { return !!this.key; }
  get modelName(): string { return this.model; }

  /**
   * Single-turn (with optional history). Returns the assistant text, or null on
   * failure / when unconfigured. Never throws — degrade gracefully.
   */
  async chat(system: string, messages: { role: 'user' | 'assistant'; content: string }[], maxTokens = 1200): Promise<string | null> {
    if (!this.key) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45_000);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model: this.model, max_tokens: maxTokens, system, messages }),
      });
      if (!res.ok) { this.log.warn(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); return null; }
      const json: any = await res.json();
      const text = Array.isArray(json?.content) ? json.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim() : '';
      return text || null;
    } catch (e: any) {
      this.log.warn(`LLM call failed: ${e?.message ?? e}`);
      return null;
    } finally { clearTimeout(t); }
  }
}

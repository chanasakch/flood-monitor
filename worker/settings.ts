import { DEFAULT_TEMPLATES, normalizeTemplate, type MessageTemplate, type TemplateKind } from '../shared/templates';
import type { Env } from './env';

/** Saved LINE templates, or the defaults when none were saved (or the stored value is unreadable). */
export async function loadTemplates(env: Env): Promise<Record<TemplateKind, MessageTemplate>> {
  const out = { ...DEFAULT_TEMPLATES };
  try {
    const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('template.alert', 'template.summary')").all<{ key: string; value: string }>();
    for (const r of results) {
      const kind = r.key.slice('template.'.length) as TemplateKind;
      out[kind] = normalizeTemplate(kind, JSON.parse(r.value));
    }
  } catch {
    /* fall back to defaults */
  }
  return out;
}

export async function saveTemplate(env: Env, kind: TemplateKind, tpl: MessageTemplate): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (key) DO UPDATE SET value = ?2, updated_at = ?3`,
  )
    .bind(`template.${kind}`, JSON.stringify(tpl), new Date().toISOString())
    .run();
}

export async function resetTemplate(env: Env, kind: TemplateKind): Promise<void> {
  await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(`template.${kind}`).run();
}

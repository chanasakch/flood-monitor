import { CloudOff, RefreshCw } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { t } from '../lib/i18n';

export function Skeleton({ h = 16, w = '100%', mt = 0 }: { h?: number; w?: string; mt?: number }) {
  return <span class="skeleton" style={{ height: `${h}px`, width: w, marginTop: `${mt}px` }} aria-hidden="true" />;
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div class="card" aria-busy="true">
      <span class="sr-only">{t('common.loading')}</span>
      <Skeleton h={22} w="55%" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} h={16} w={`${90 - i * 14}%`} mt={12} />
      ))}
    </div>
  );
}

export function ErrorState({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  return (
    <div class="state" role="alert">
      <span class="state-icon">
        <CloudOff size={26} aria-hidden="true" />
      </span>
      <h3>{message ?? t('common.loadError')}</h3>
      <p>{t('common.loadErrorHint')}</p>
      {onRetry && (
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" onClick={onRetry}>
            <RefreshCw size={18} aria-hidden="true" />
            {t('common.retry')}
          </button>
        </div>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, text, children }: { icon: ComponentChildren; title: string; text?: string; children?: ComponentChildren }) {
  return (
    <div class="state">
      <span class="state-icon">{icon}</span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children && <div class="btn-row">{children}</div>}
    </div>
  );
}

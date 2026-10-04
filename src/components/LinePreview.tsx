import { ChevronLeft, Menu, Phone, Search } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../lib/i18n';

export interface Device {
  id: string;
  label: string;
  width: number;
  height: number;
  os: 'ios' | 'android';
}

/** Common screen sizes in CSS pixels (points), which is what LINE lays text out in. */
export const DEVICES: Device[] = [
  { id: 'se', label: 'iPhone SE', width: 375, height: 667, os: 'ios' },
  { id: 'ip15', label: 'iPhone 15', width: 393, height: 852, os: 'ios' },
  { id: 'promax', label: 'iPhone Pro Max', width: 430, height: 932, os: 'ios' },
  { id: 'android', label: 'Android', width: 412, height: 915, os: 'android' },
  { id: 'tablet', label: 'iPad', width: 768, height: 1024, os: 'ios' },
];

const hhmm = (ms: number) => new Date(ms + 7 * 3600000).toISOString().slice(11, 16);

/** LINE turns web addresses into links; show them the same way. */
function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => (/^https?:\/\//.test(p) ? <span key={i} class="lp-link">{p}</span> : p));
}

interface Props {
  text: string;
  device: Device;
  accountName: string;
  now: number;
}

/**
 * Approximation of how the message appears in LINE on a given screen: chat bubble width, line
 * breaks and the lock-screen notification. Fonts and emoji come from this browser, so on another
 * phone the exact glyphs can differ slightly.
 */
export function LinePreview({ text, device, accountName, now }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Fit the phone into the available width without changing its layout width.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / (device.width + 24))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [device.width]);

  const time = hhmm(now);
  const screenH = Math.min(device.height, 760);
  const firstLines = text.split('\n').filter((l) => l.trim());

  return (
    <div class="lp" ref={host}>
      <div class={`lp-notif lp-${device.os}`} aria-label={t('tpl.lockScreen')} role="img">
        <div class="lp-notif-head">
          <span class="lp-app-icon" aria-hidden="true" />
          <span>LINE</span>
          <span class="lp-notif-time">{device.os === 'ios' ? t('tpl.justNow') : time}</span>
        </div>
        <div class="lp-notif-title">{accountName}</div>
        <div class="lp-notif-body">{firstLines.join('\n')}</div>
      </div>
      <p class="lp-caption muted small">{t(device.os === 'ios' ? 'tpl.notifIos' : 'tpl.notifAndroid')}</p>

      <div class="lp-stage" style={{ height: `${(screenH + 24) * scale}px` }}>
        <div
          class={`lp-phone lp-${device.os}`}
          style={{ width: `${device.width}px`, height: `${screenH}px`, transform: `scale(${scale})` }}
          role="img"
          aria-label={t('tpl.chatPreview', { device: device.label })}
        >
          <div class="lp-status">
            <span>{time}</span>
            <span aria-hidden="true">●●● 5G ▮</span>
          </div>
          <div class="lp-header">
            <ChevronLeft size={22} aria-hidden="true" />
            <span class="lp-header-name">{accountName}</span>
            <span class="lp-header-icons" aria-hidden="true">
              <Search size={18} />
              <Phone size={18} />
              <Menu size={18} />
            </span>
          </div>
          <div class="lp-chat" tabIndex={0} aria-label={t('tpl.chatPreview', { device: device.label })}>
            <div class="lp-date">{t('tpl.today')}</div>
            <div class="lp-row">
              <img class="lp-avatar" src="/icon-192.png" alt="" width="36" height="36" />
              <div class="lp-bubble-wrap">
                <div class="lp-bubble">{linkify(text)}</div>
                <span class="lp-time">{time}</span>
              </div>
            </div>
          </div>
          <div class="lp-input" aria-hidden="true">
            <span>+</span>
            <span class="lp-input-box">Aa</span>
            <span>☺</span>
          </div>
        </div>
      </div>
    </div>
  );
}

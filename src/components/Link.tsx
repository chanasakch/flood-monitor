import type { ComponentChildren, JSX } from 'preact';
import { onLinkClick } from '../lib/router';

interface Props extends Omit<JSX.HTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
  children: ComponentChildren;
}

/** In-app link: real <a href> for accessibility, client-side navigation on plain clicks. */
export function Link({ to, children, ...rest }: Props) {
  return (
    <a href={to} onClick={(e) => onLinkClick(e as unknown as MouseEvent, to)} {...rest}>
      {children}
    </a>
  );
}

interface ExtProps {
  href: string;
  children: ComponentChildren;
  class?: string;
  label?: string;
}

/** External link to an official source. Always opens in a new tab without leaking the referrer. */
export function ExtLink({ href, children, class: cls, label }: ExtProps) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" class={cls} aria-label={label}>
      {children}
    </a>
  );
}

import type { ReactNode } from 'react';
import './Screen.css';

interface Props {
  eyebrow?: string;
  title?: string;
  lead?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Screen({ eyebrow, title, lead, children, footer }: Props) {
  return (
    <div className="screen">
      <div className="screen__body">
        {eyebrow && <div className="screen__eyebrow">{eyebrow}</div>}
        {title && <h1 className="screen__title">{title}</h1>}
        {lead && <p className="screen__lead">{lead}</p>}
        {children}
      </div>
      {footer && <div className="screen__footer">{footer}</div>}
    </div>
  );
}

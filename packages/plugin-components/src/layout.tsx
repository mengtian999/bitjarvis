import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './classnames';

export interface CardShellProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

export function CardShell({
  title,
  description,
  actions,
  footer,
  children,
  className,
  ...sectionProps
}: CardShellProps) {
  return (
    <section {...sectionProps} className={cx('jarvis-plugin-card', className)}>
      {(title || description || actions) && (
        <header className="jarvis-plugin-card-header">
          <div className="jarvis-plugin-card-heading">
            {title && <h2 className="jarvis-plugin-card-title">{title}</h2>}
            {description && <p className="jarvis-plugin-card-description">{description}</p>}
          </div>
          {actions && <div className="jarvis-plugin-card-actions">{actions}</div>}
        </header>
      )}
      <div className="jarvis-plugin-card-body">{children}</div>
      {footer && <footer className="jarvis-plugin-card-footer">{footer}</footer>}
    </section>
  );
}

export interface SettingRowProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  hint?: ReactNode;
  control: ReactNode;
  layout?: 'inline' | 'stacked';
}

export function SettingRow({
  label,
  hint,
  control,
  layout = 'inline',
  className,
  ...rowProps
}: SettingRowProps) {
  return (
    <div
      {...rowProps}
      className={cx(
        'jarvis-plugin-setting-row',
        layout === 'stacked' ? 'jarvis-plugin-setting-row-stacked' : 'jarvis-plugin-setting-row-inline',
        className,
      )}
    >
      <div className="jarvis-plugin-setting-text">
        <div className="jarvis-plugin-setting-label">{label}</div>
        {hint && <div className="jarvis-plugin-setting-hint">{hint}</div>}
      </div>
      <div className="jarvis-plugin-setting-control">{control}</div>
    </div>
  );
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action, className, ...rootProps }: EmptyStateProps) {
  return (
    <div {...rootProps} className={cx('jarvis-plugin-empty', className)}>
      {icon && <div className="jarvis-plugin-empty-icon">{icon}</div>}
      <div className="jarvis-plugin-empty-title">{title}</div>
      {description && <div className="jarvis-plugin-empty-description">{description}</div>}
      {action && <div className="jarvis-plugin-empty-action">{action}</div>}
    </div>
  );
}

export interface ListItem {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}

export interface ListProps extends HTMLAttributes<HTMLUListElement> {
  items: ListItem[];
}

export function List({ items, className, ...listProps }: ListProps) {
  return (
    <ul {...listProps} className={cx('jarvis-plugin-list', className)}>
      {items.map((item) => (
        <li key={item.id} className="jarvis-plugin-list-item">
          {item.icon && <div className="jarvis-plugin-list-icon">{item.icon}</div>}
          <div className="jarvis-plugin-list-main">
            <div className="jarvis-plugin-list-line">
              <span className="jarvis-plugin-list-title">{item.title}</span>
              {item.meta && <span className="jarvis-plugin-list-meta">{item.meta}</span>}
            </div>
            {item.description && <div className="jarvis-plugin-list-description">{item.description}</div>}
          </div>
          {item.action && <div className="jarvis-plugin-list-action">{item.action}</div>}
        </li>
      ))}
    </ul>
  );
}

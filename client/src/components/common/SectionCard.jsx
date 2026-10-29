import { Icon } from './Icon.jsx';

/** Card with a titled header row — the base container for dashboard panels. */
export function SectionCard({ icon, title, subtitle, action, children, className = '', bodyClassName = '', compact = false }) {
  return (
    <section className={`card flex min-h-0 flex-col ${className}`}>
      <header className={`flex items-start justify-between border-b border-line ${compact ? 'gap-2 px-3 py-2.5' : 'gap-4 px-5 py-4'}`}>
        <div className={`flex min-w-0 items-start ${compact ? 'gap-2' : 'gap-3'}`}>
          {icon && (
            <span className={`mt-0.5 flex shrink-0 items-center justify-center bg-subcanvas text-cypress ${compact ? 'h-6 w-6 rounded-lg' : 'h-8 w-8 rounded-xl'}`}>
              <Icon name={icon} size={16} />
            </span>
          )}
          <div className="min-w-0">
            <h2 className={`truncate font-display text-ink ${compact ? 'text-label-md' : 'text-head-sm'}`}>{title}</h2>
            {subtitle && <p className="mt-0.5 text-body-sm text-ink-3">{subtitle}</p>}
          </div>
        </div>
        {action}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export default SectionCard;

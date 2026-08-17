export type AdminSectionProps = Readonly<{
  titleId: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  extra?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}>;

export function AdminSection({
  titleId,
  title,
  description,
  icon,
  extra,
  className,
  children,
}: AdminSectionProps): React.ReactElement {
  return (
    <section className={["admin-section", className].filter(Boolean).join(" ")} aria-labelledby={titleId}>
      <header className="section-heading">
        <div>
          <h2 id={titleId}>
            {icon === undefined ? null : <span className="admin-section-icon" aria-hidden="true">{icon}</span>}
            <span>{title}</span>
          </h2>
          {description === undefined ? null : <p>{description}</p>}
        </div>
        {extra === undefined ? null : <div className="section-extra">{extra}</div>}
      </header>
      {children}
    </section>
  );
}

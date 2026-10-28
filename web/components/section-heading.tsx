import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  href,
  linkLabel
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  href?: string
  linkLabel?: string
}) {
  return (
    <div className="section-head">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 className="section-title">{title}</h2>
        {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
      </div>
      {href && linkLabel ? (
        <Link className="section-link" href={href}>
          {linkLabel}
          <ArrowRight aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  )
}

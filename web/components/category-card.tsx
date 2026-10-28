import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { Category } from '@/lib/catalog'
import { CategoryIcon } from '@/components/category-icon'

export function CategoryCard({ category }: { category: Category }) {
  return (
    <Link className="category-card" href={`/catalogo?categoria=${category.slug}`}>
      <div className="category-media">
        <span className="category-icon">
          <CategoryIcon category={category.name} />
        </span>
      </div>
      <div className="category-body">
        <div>
          <h3 className="category-name">{category.name}</h3>
          <p className="category-count">
            {category.count} {category.count === 1 ? 'referencia' : 'referencias'}
          </p>
        </div>
        <span className="category-arrow" aria-hidden="true">
          <ArrowRight />
        </span>
      </div>
    </Link>
  )
}

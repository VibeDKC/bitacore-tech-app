import { Cable, HardDrive, Keyboard, Package, Wrench } from 'lucide-react'

export function CategoryIcon({
  category,
  className
}: {
  category: string
  className?: string
}) {
  if (category === 'Periféricos') return <Keyboard className={className} aria-hidden="true" />
  if (category === 'Almacenamiento') return <HardDrive className={className} aria-hidden="true" />
  if (category === 'Accesorios') return <Cable className={className} aria-hidden="true" />
  if (category === 'Servicios') return <Wrench className={className} aria-hidden="true" />
  return <Package className={className} aria-hidden="true" />
}

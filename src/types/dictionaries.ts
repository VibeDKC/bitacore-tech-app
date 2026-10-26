export const DICTIONARY_TYPES = [
  {
    value: 'device_type',
    label: 'Tipos de equipo',
    description: 'Tipos que aparecen al recibir una OT.'
  },
  {
    value: 'os',
    label: 'Sistemas operativos',
    description: 'Nombres y versiones para la ficha técnica.'
  },
  {
    value: 'cpu_brand',
    label: 'Marcas y familias de CPU',
    description: 'Marca principal y familias como Core i7 o Ryzen 5.'
  },
  {
    value: 'gpu_brand',
    label: 'Marcas de GPU',
    description: 'Fabricantes de tarjetas gráficas.'
  },
  {
    value: 'ram_type',
    label: 'Tipos de RAM',
    description: 'DDR3, DDR4, DDR5, LPDDR y variantes.'
  },
  {
    value: 'storage_type',
    label: 'Tipos de almacenamiento',
    description: 'HDD, SSD SATA, M.2 NVMe, eMMC y similares.'
  },
  {
    value: 'inventory_category',
    label: 'Categorías de inventario',
    description: 'Agrupación de productos en el inventario y POS.'
  },
  {
    value: 'inventory_location',
    label: 'Ubicaciones de inventario',
    description: 'Bodegas, estantes, taller y mostrador.'
  },
  {
    value: 'supplier_category',
    label: 'Categorías de proveedor',
    description: 'Agrupación de proveedores para compras.'
  },
  {
    value: 'service_type',
    label: 'Tipos de servicio',
    description: 'Catálogo de servicios técnicos del taller.'
  }
] as const

export type DictionaryType = (typeof DICTIONARY_TYPES)[number]['value']

export interface DictionaryNode {
  id: string
  parentId: string | null
  type: DictionaryType
  code: string | null
  name: string
  sortOrder: number
  active: boolean
  system: boolean
  usageCount: number
  createdAt?: string
  updatedAt?: string
}

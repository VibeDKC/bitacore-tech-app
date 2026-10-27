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
    value: 'inventory_condition',
    label: 'Condiciones de inventario',
    description: 'Nuevo, usado, reacondicionado o para repuesto.'
  },
  {
    value: 'inventory_origin',
    label: 'Orígenes de inventario',
    description: 'Compra local, importado, devolución o aportado por el cliente.'
  },
  {
    value: 'component_brand',
    label: 'Marcas de componentes',
    description: 'Marcas de RAM, almacenamiento y otros componentes.'
  },
  {
    value: 'supplier_category',
    label: 'Categorías de proveedor',
    description: 'Agrupación de proveedores para compras.'
  },
  {
    value: 'service_type',
    label: 'Tipos de servicio y mantenimiento',
    description: 'Servicios que aparecen como motivo de ingreso en la OT y en el inventario.'
  },
  {
    value: 'purchase_payment_account',
    label: 'Cuentas de compra',
    description: 'Tarjetas y cuentas con las que se pagan compras y abonos a proveedores.'
  },
  {
    value: 'income_account',
    label: 'Cuenta de ingresos',
    description: 'Cuenta bancaria que recibe los pagos digitales y los traslados de efectivo.'
  }
] as const

export type DictionaryType = (typeof DICTIONARY_TYPES)[number]['value']

export interface DictionaryNode {
  id: string
  parentId: string | null
  type: DictionaryType
  code: string | null
  channel?: string | null
  name: string
  sortOrder: number
  active: boolean
  system: boolean
  usageCount: number
  responsibleUserId?: string | null
  linkedIncomeAccountId?: string | null
  createdAt?: string
  updatedAt?: string
}

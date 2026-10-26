import { DICTIONARY_TYPES, type DictionaryNode, type DictionaryType } from '@/types'

export function sortDictionaryNodes(nodes: DictionaryNode[]) {
  return [...nodes].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es'))
}

export function dictionaryChildren(nodes: DictionaryNode[], type: DictionaryType, parentId: string | null = null) {
  return sortDictionaryNodes(nodes.filter((node) => node.type === type && (node.parentId ?? null) === parentId))
}

export function activeDictionaryNodes(nodes: DictionaryNode[], type: DictionaryType, parentId: string | null = null) {
  return dictionaryChildren(nodes, type, parentId).filter((node) => node.active)
}

export function dictionaryValues(nodes: DictionaryNode[], type: DictionaryType, parentId: string | null = null) {
  return activeDictionaryNodes(nodes, type, parentId).map((node) => node.name)
}

export function flattenDictionaryTree(nodes: DictionaryNode[], type: DictionaryType) {
  const rows: Array<{ node: DictionaryNode; depth: number }> = []
  const walk = (parentId: string | null, depth: number) => {
    for (const node of dictionaryChildren(nodes, type, parentId)) {
      rows.push({ node, depth })
      walk(node.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

export function dictionaryTypeLabel(type: DictionaryType) {
  const found = DICTIONARY_TYPES.find((item) => item.value === type)
  return found?.label ?? type
}

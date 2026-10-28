export function slugify(value: string) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function uniqueSlug(base: string, used: Set<string>) {
  let slug = base || 'producto'
  let index = 2
  while (used.has(slug)) {
    slug = `${base}-${index}`
    index += 1
  }
  used.add(slug)
  return slug
}

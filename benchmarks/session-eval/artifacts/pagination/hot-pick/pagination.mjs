export function paginate(items, page, size) {
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }
  if (!Number.isSafeInteger(page) || page <= 0) {
    throw new TypeError('page must be a positive safe integer');
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new TypeError('size must be a positive safe integer');
  }

  const totalItems = items.length;
  const totalPages = Math.ceil(totalItems / size);
  const start = (page - 1) * size;

  return {
    items: page > totalPages ? [] : items.slice(start, start + size),
    page,
    totalPages,
    totalItems,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
  };
}

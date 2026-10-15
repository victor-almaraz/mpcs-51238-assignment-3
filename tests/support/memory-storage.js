/** In-memory Storage with the surface localStorage exposes; `quota` limits total characters. */
export class MemoryStorage {
  #map = new Map();
  quota = Infinity;
  get length() {
    return this.#map.size;
  }
  key(i) {
    return [...this.#map.keys()][i] ?? null;
  }
  getItem(k) {
    return this.#map.has(k) ? this.#map.get(k) : null;
  }
  setItem(k, v) {
    let size = k.length + String(v).length;
    for (const [a, b] of this.#map) if (a !== k) size += a.length + b.length;
    if (size > this.quota) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    this.#map.set(k, String(v));
  }
  removeItem(k) {
    this.#map.delete(k);
  }
  clear() {
    this.#map.clear();
  }
}

/*
 * Fixed-capacity circular buffers over typed arrays. Capacity is set at
 * construction; no method allocates.
 */

/** Ring of the most recent `capacity` values with a running sum. */
export class Ring {
  /**
   * @param {number} capacity number of values held
   * @param {Function} [Type] typed-array constructor (default Float64Array)
   */
  constructor(capacity, Type = Float64Array) {
    if (!(capacity >= 1)) throw new Error('Ring capacity must be ≥ 1');
    this.data = new Type(capacity);
    this.capacity = capacity;
    this.size = 0;
    this.head = 0; // index of the next write
    this.sum = 0;
  }

  /** Appends `x`; when full, drops the oldest value and returns it, else returns 0. */
  push(x) {
    let evicted = 0;
    if (this.size === this.capacity) evicted = this.data[this.head];
    else this.size++;
    this.data[this.head] = x;
    this.sum += x - evicted;
    this.head = this.head + 1 === this.capacity ? 0 : this.head + 1;
    return evicted;
  }

  /** Value pushed `age` pushes ago (0 = newest). `age` must be < size. */
  get(age) {
    let i = this.head - 1 - age;
    if (i < 0) i += this.capacity;
    return this.data[i];
  }

  /** Recomputes the running sum from the stored values, removing accumulated rounding drift. */
  resum() {
    let s = 0;
    for (let i = 0; i < this.size; i++) s += this.get(i);
    this.sum = s;
  }

  /** Empties the ring. */
  clear() {
    this.size = 0;
    this.head = 0;
    this.sum = 0;
    this.data.fill(0);
  }
}

/** Double-ended queue (for sliding minimum and maximum filters). */
export class Deque {
  /**
   * @param {number} capacity maximum number of values held
   * @param {Function} [Type] typed-array constructor (default Float64Array)
   */
  constructor(capacity, Type = Float64Array) {
    if (!(capacity >= 1)) throw new Error('Deque capacity must be ≥ 1');
    this.data = new Type(capacity);
    this.capacity = capacity;
    this.start = 0;
    this.size = 0;
  }

  #index(offset) {
    const i = this.start + offset;
    return i >= this.capacity ? i - this.capacity : i;
  }

  /** Appends `x` at the back. Throws when full: callers size the deque for their window. */
  pushBack(x) {
    if (this.size === this.capacity) throw new Error('Deque full');
    this.data[this.#index(this.size)] = x;
    this.size++;
  }

  /** Removes and returns the back value. */
  popBack() {
    this.size--;
    return this.data[this.#index(this.size)];
  }

  /** Removes and returns the front value. */
  popFront() {
    const x = this.data[this.start];
    this.start = this.start + 1 === this.capacity ? 0 : this.start + 1;
    this.size--;
    return x;
  }

  /** Front value (oldest). The deque must not be empty. */
  front() {
    return this.data[this.start];
  }

  /** Back value (newest). The deque must not be empty. */
  back() {
    return this.data[this.#index(this.size - 1)];
  }

  /** Empties the deque. */
  clear() {
    this.start = 0;
    this.size = 0;
  }
}

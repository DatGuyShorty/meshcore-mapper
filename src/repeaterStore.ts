export function createRepeaterStore<TRepeater = any>(initialNextId = 1) {
  let repeaters: TRepeater[] = [];
  let nextId = initialNextId;

  return {
    getRepeaters(): TRepeater[] {
      return repeaters;
    },
    setRepeaters(nextRepeaters: TRepeater[]): void {
      repeaters = Array.isArray(nextRepeaters) ? nextRepeaters : [];
    },
    getNextId(): number {
      return nextId;
    },
    setNextId(value: number): void {
      nextId = Number.isFinite(value) ? value : initialNextId;
    },
    allocateId(): number {
      const id = nextId;
      nextId += 1;
      return id;
    },
    reset(): void {
      repeaters = [];
      nextId = initialNextId;
    },
  };
}

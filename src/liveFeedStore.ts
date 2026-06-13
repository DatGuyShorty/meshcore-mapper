export function createLiveFeedStore<TConnection = WebSocket>() {
  let connection: TConnection | null = null;
  const repeaterIds = new Set<number>();

  return {
    getConnection(): TConnection | null {
      return connection;
    },
    setConnection(nextConnection: TConnection | null): void {
      connection = nextConnection;
    },
    clearConnection(): void {
      connection = null;
    },
    hasConnection(): boolean {
      return connection !== null;
    },
    addRepeaterId(id: number): void {
      repeaterIds.add(id);
    },
    deleteRepeaterId(id: number): void {
      repeaterIds.delete(id);
    },
    clearRepeaterIds(): void {
      repeaterIds.clear();
    },
    getRepeaterIds(): number[] {
      return [...repeaterIds];
    },
    getRepeaterCount(): number {
      return repeaterIds.size;
    },
  };
}

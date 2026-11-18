/** Fila em processo com concorrência limitada. */
export class JobQueue {
  private running = 0;
  private readonly pending: (() => Promise<void>)[] = [];
  private idleResolvers: (() => void)[] = [];

  constructor(private readonly concurrency: number) {}

  get size(): number {
    return this.pending.length + this.running;
  }

  push(task: () => Promise<void>): void {
    this.pending.push(task);
    this.drain();
  }

  /** Resolve quando não houver tarefas pendentes nem em execução (usado em testes e shutdown). */
  onIdle(): Promise<void> {
    if (this.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  private drain() {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift()!;
      this.running++;
      void task()
        .catch(() => undefined)
        .finally(() => {
          this.running--;
          if (this.size === 0) {
            const resolvers = this.idleResolvers;
            this.idleResolvers = [];
            resolvers.forEach((r) => r());
          }
          this.drain();
        });
    }
  }
}

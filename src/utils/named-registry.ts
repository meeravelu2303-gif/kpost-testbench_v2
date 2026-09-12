/** Registry for items addressed by a string ID (business rules, DB validations). */
export class NamedRegistry<T extends { id: string }> {
  private readonly items = new Map<string, T>();

  constructor(private readonly kind: string) {}

  register(...items: T[]): this {
    for (const item of items) {
      if (this.items.has(item.id))
        throw new Error(`${this.kind} "${item.id}" is already registered`);
      this.items.set(item.id, item);
    }
    return this;
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  all(): T[] {
    return [...this.items.values()];
  }
}

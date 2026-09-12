import type { Validator } from './validator';

/**
 * Central list of validators. The engine discovers validators only through a registry, so a
 * validator registered once (src/validators/index.ts) applies to every endpoint automatically.
 */
export class ValidationRegistry {
  private readonly validators = new Map<string, Validator>();

  register(...validators: Validator[]): this {
    for (const validator of validators) {
      if (this.validators.has(validator.name)) {
        throw new Error(`Validator "${validator.name}" is already registered`);
      }
      this.validators.set(validator.name, validator);
    }
    return this;
  }

  get(name: string): Validator | undefined {
    return this.validators.get(name);
  }

  has(name: string): boolean {
    return this.validators.has(name);
  }

  /** Registration order is the tie-breaker for validators in the same stage. */
  all(): Validator[] {
    return [...this.validators.values()];
  }

  /** Independent copy — lets tests add validators without touching the global registry. */
  clone(): ValidationRegistry {
    return new ValidationRegistry().register(...this.all());
  }
}

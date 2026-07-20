import type { DemoDataAdapter } from "./types";

export interface DemoEntity {
  id: string;
}

export interface DemoRepository<T extends DemoEntity> {
  list(): Promise<readonly T[]>;
  getById(id: string): Promise<T | null>;
  create(entity: T): Promise<T>;
  update(id: string, patch: Partial<Omit<T, "id">>): Promise<T>;
  remove(id: string): Promise<boolean>;
  replaceAll(entities: readonly T[]): Promise<readonly T[]>;
}

export class DemoRepositoryConflictError extends Error {
  constructor(id: string) {
    super(`A demo entity with id '${id}' already exists.`);
    this.name = "DemoRepositoryConflictError";
  }
}

export class DemoRepositoryNotFoundError extends Error {
  constructor(id: string) {
    super(`Demo entity '${id}' was not found.`);
    this.name = "DemoRepositoryNotFoundError";
  }
}

/** Generic collection repository backed by the selected demo-data adapter. */
export class AdapterDemoRepository<T extends DemoEntity> implements DemoRepository<T> {
  constructor(
    private readonly adapter: DemoDataAdapter,
    private readonly collectionKey: string,
  ) {}

  async list(): Promise<readonly T[]> {
    return (await this.adapter.read<T[]>(this.collectionKey)) ?? [];
  }

  async getById(id: string): Promise<T | null> {
    return (await this.list()).find((entity) => entity.id === id) ?? null;
  }

  async create(entity: T): Promise<T> {
    await this.adapter.update<T[]>(this.collectionKey, (current) => {
      const entities = current ?? [];
      if (entities.some((candidate) => candidate.id === entity.id)) {
        throw new DemoRepositoryConflictError(entity.id);
      }
      return [...entities, entity];
    });
    return entity;
  }

  async update(id: string, patch: Partial<Omit<T, "id">>): Promise<T> {
    let updated: T | null = null;
    await this.adapter.update<T[]>(this.collectionKey, (current) => {
      const entities = current ?? [];
      const index = entities.findIndex((entity) => entity.id === id);
      if (index < 0) throw new DemoRepositoryNotFoundError(id);
      updated = { ...entities[index], ...patch, id } as T;
      return entities.map((entity, entityIndex) => (entityIndex === index ? (updated as T) : entity));
    });
    if (!updated) throw new DemoRepositoryNotFoundError(id);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    let removed = false;
    await this.adapter.update<T[]>(this.collectionKey, (current) => {
      const entities = current ?? [];
      removed = entities.some((entity) => entity.id === id);
      return entities.filter((entity) => entity.id !== id);
    });
    return removed;
  }

  async replaceAll(entities: readonly T[]): Promise<readonly T[]> {
    const ids = new Set<string>();
    for (const entity of entities) {
      if (ids.has(entity.id)) throw new DemoRepositoryConflictError(entity.id);
      ids.add(entity.id);
    }
    const copy = [...entities];
    await this.adapter.write(this.collectionKey, copy);
    return copy;
  }
}


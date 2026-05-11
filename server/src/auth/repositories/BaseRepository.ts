export interface BaseRepository<TEntity, TKey> {
  findById(id: TKey): TEntity | null;
  save(entity: TEntity): TEntity;
  delete(id: TKey): void;
}

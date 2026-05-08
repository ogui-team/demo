import { ITEM_CATALOG, CATALOG_MAP } from '../../server/src/data/itemCatalog'

describe('ItemCatalog', () => {
  it('builds a catalog index from the full item list', () => {
    expect(CATALOG_MAP.size).toBe(ITEM_CATALOG.length)
    expect(CATALOG_MAP.get('weapon_pistol')).toEqual(
      expect.objectContaining({
        id: 'weapon_pistol',
        label: 'Pistol',
        type: 'weapon',
      }),
    )
  })

  it('contains consumables and ammo entries with stats', () => {
    const healthPotion = CATALOG_MAP.get('health_potion_sm')
    expect(healthPotion).toBeDefined()
    expect(healthPotion?.stats).toMatchObject({ heal: 25 })

    const rifleMag = CATALOG_MAP.get('ammo_rifle_mag')
    expect(rifleMag).toBeDefined()
    expect(rifleMag?.stats).toMatchObject({ rounds: 30 })
  })

  it('supports key items and no-stats misc items', () => {
    const redKey = CATALOG_MAP.get('key_red')
    expect(redKey).toBeDefined()
    expect(redKey?.type).toBe('key')
    expect(redKey?.stats).toBeUndefined()

    const goldCoin = CATALOG_MAP.get('gold_coin')
    expect(goldCoin).toBeDefined()
    expect(goldCoin?.maxStack).toBe(99)
  })
})

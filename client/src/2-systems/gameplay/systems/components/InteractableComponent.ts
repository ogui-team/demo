/**
 * InteractableComponent
 *
 * Data component attached to entities that can be interacted with in the world.
 * Stored on an Entity via:
 *   entity.addComponent({
 *     name: 'interactable',
 *     data: createInteractableComponent({ ... }) as unknown as Record<string, any>,
 *   });
 *
 * Consumed by:
 *   - ProximityInteraction  — scans for nearby highlightable entities
 *   - PickupSystem          — reads pickupable + itemId on E-key press
 *   - HighlightSystem       — reads highlightColor for visual override
 *
 * Does NOT contain gameplay state. It is pure declaration.
 */

export type InteractionType = 'item' | 'physics' | 'door' | 'npc';

export interface InteractableComponent {
  /** Discriminator — always 'interactable'. */
  readonly type: 'interactable';

  /** Semantic category used by systems to filter interaction types. */
  interactionType: InteractionType;

  /**
   * Whether this entity can be picked up via the PickupSystem (E key).
   * Set to false for doors, buttons, NPCs that need custom handling.
   */
  pickupable: boolean;

  /**
   * Whether this entity should receive a visual highlight when nearby or targeted.
   * Set to false to participate in other interactions without visual noise.
   */
  highlightable: boolean;

  /**
   * THREE.js hex color for the box-outline highlight in proximity mode.
   * Defaults to amber (0xd4a850) when undefined.
   */
  highlightColor?: number;

  /**
   * THREE.js hex color for the held-state highlight (physgun-held).
   * Defaults to cyan (0x80d4ff) when undefined.
   */
  heldColor?: number;

  /**
   * Item ID passed to InventorySystem.addItem() on pickup.
   * Only required when interactionType === 'item' && pickupable === true.
   */
  itemId?: string;

  /** Quantity to grant on pickup. Defaults to 1. */
  quantity?: number;

  /**
   * Short label shown in the interaction prompt HUD (e.g. "Health Pack").
   * Falls back to itemId when omitted.
   */
  prompt?: string;
}

/** Factory with sensible defaults for a world pick-up item. */
export function createInteractableComponent(
  config: Omit<InteractableComponent, 'type'>,
): InteractableComponent {
  return {
    type:           'interactable',
    highlightColor: 0xd4a850,
    quantity:       1,
    ...config,
  };
}

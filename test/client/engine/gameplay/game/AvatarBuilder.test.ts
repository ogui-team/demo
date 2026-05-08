import { describe, expect, it } from 'vitest'
import { normalizeAvatarAppearance, createAvatarGroup, disposeAvatarGroup, AVATAR_SCALE_MIN, AVATAR_SCALE_XZ_MAX, AVATAR_SCALE_Y_MAX } from '../../../../../client/src/engine/gameplay/game/AvatarBuilder'

describe('AvatarBuilder', () => {
  it('normalizes appearance defaults and clamps scale values', () => {
    const appearance = normalizeAvatarAppearance({
      modelVariant: 'heavy',
      textureStyle: 'checker',
      bodyColor: 0x112233,
      accentColor: 0x445566,
      skinColor: 0x778899,
      legColor: 0xaabbcc,
      widthScale: 10,
      heightScale: -5,
    })

    expect(appearance.modelVariant).toBe('heavy')
    expect(appearance.textureStyle).toBe('checker')
    expect(appearance.bodyColor).toBe(0x112233)
    expect(appearance.accentColor).toBe(0x445566)
    expect(appearance.skinColor).toBe(0x778899)
    expect(appearance.legColor).toBe(0xaabbcc)
    expect(appearance.scaleX).toBe(AVATAR_SCALE_XZ_MAX)
    expect(appearance.scaleY).toBe(AVATAR_SCALE_MIN)
    expect(appearance.scaleZ).toBe(AVATAR_SCALE_XZ_MAX)
  })

  it('creates an avatar group with the expected rig and metadata', () => {
    const group = createAvatarGroup({ modelVariant: 'scout', textureStyle: 'stripes', bodyColor: 0x123456, accentColor: 0x654321 }, { includeHitbox: false })

    expect(group.userData.avatarAppearance).toBeDefined()
    expect(group.userData.avatarRig).toBeDefined()
    expect(group.userData.avatarRootOffsetY).toBeDefined()
    expect(group.userData.avatarRestPose).toBeDefined()
    expect(group.userData.avatarAppearance.modelVariant).toBe('scout')

    const rig = group.userData.avatarRig
    expect(rig.torso).toBeDefined()
    expect(rig.head).toBeDefined()
    expect(rig.leftArm).toBeDefined()
    expect(rig.rightArm).toBeDefined()
    expect(rig.leftLeg).toBeDefined()
    expect(rig.rightLeg).toBeDefined()

    expect(group.children.some((child) => child.userData.isHitbox)).toBe(false)
    expect(group.scale.x).toBeGreaterThanOrEqual(AVATAR_SCALE_MIN)
    expect(group.scale.y).toBeGreaterThanOrEqual(AVATAR_SCALE_MIN)
  })

  it('disposes avatar group resources without throwing', () => {
    const group = createAvatarGroup({}, { includeHitbox: true })
    expect(() => disposeAvatarGroup(group)).not.toThrow()
  })
})

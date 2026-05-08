export class Vec2 {
  constructor(public x = 0, public y = 0) {}

  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  add(other: Vec2): Vec2 {
    return new Vec2(this.x + other.x, this.y + other.y);
  }

  subtract(other: Vec2): Vec2 {
    return new Vec2(this.x - other.x, this.y - other.y);
  }

  scale(scalar: number): Vec2 {
    return new Vec2(this.x * scalar, this.y * scalar);
  }

  dot(other: Vec2): number {
    return this.x * other.x + this.y * other.y;
  }

  length(): number {
    return Math.hypot(this.x, this.y);
  }

  normalize(): Vec2 {
    const length = this.length();
    if (length === 0) {
      return new Vec2(0, 0);
    }
    return this.scale(1 / length);
  }

  static distance(a: Vec2, b: Vec2): number {
    return a.subtract(b).length();
  }
}

export class Vec3 {
  constructor(public x = 0, public y = 0, public z = 0) {}

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  add(other: Vec3): Vec3 {
    return new Vec3(this.x + other.x, this.y + other.y, this.z + other.z);
  }

  subtract(other: Vec3): Vec3 {
    return new Vec3(this.x - other.x, this.y - other.y, this.z - other.z);
  }

  scale(scalar: number): Vec3 {
    return new Vec3(this.x * scalar, this.y * scalar, this.z * scalar);
  }

  dot(other: Vec3): number {
    return this.x * other.x + this.y * other.y + this.z * other.z;
  }

  cross(other: Vec3): Vec3 {
    return new Vec3(
      this.y * other.z - this.z * other.y,
      this.z * other.x - this.x * other.z,
      this.x * other.y - this.y * other.x,
    );
  }

  length(): number {
    return Math.hypot(this.x, this.y, this.z);
  }

  normalize(): Vec3 {
    const length = this.length();
    if (length === 0) {
      return new Vec3(0, 0, 0);
    }
    return this.scale(1 / length);
  }

  distance(other: Vec3): number {
    return Vec3.distance(this, other);
  }

  static distance(a: Vec3, b: Vec3): number {
    return a.subtract(b).length();
  }

  static lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return new Vec3(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
      a.z + (b.z - a.z) * t,
    );
  }
}

export class Vec4 {
  constructor(public x = 0, public y = 0, public z = 0, public w = 0) {}

  clone(): Vec4 {
    return new Vec4(this.x, this.y, this.z, this.w);
  }

  dot(other: Vec4): number {
    return this.x * other.x + this.y * other.y + this.z * other.z + this.w * other.w;
  }
}

export class Quaternion {
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}

  clone(): Quaternion {
    return new Quaternion(this.x, this.y, this.z, this.w);
  }

  multiply(other: Quaternion): Quaternion {
    return new Quaternion(
      this.w * other.x + this.x * other.w + this.y * other.z - this.z * other.y,
      this.w * other.y - this.x * other.z + this.y * other.w + this.z * other.x,
      this.w * other.z + this.x * other.y - this.y * other.x + this.z * other.w,
      this.w * other.w - this.x * other.x - this.y * other.y - this.z * other.z,
    );
  }

  normalize(): Quaternion {
    const magnitude = Math.hypot(this.x, this.y, this.z, this.w);
    if (magnitude === 0) {
      return new Quaternion(0, 0, 0, 1);
    }
    return new Quaternion(
      this.x / magnitude,
      this.y / magnitude,
      this.z / magnitude,
      this.w / magnitude,
    );
  }

  invert(): Quaternion {
    const magnitude = this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
    if (magnitude === 0) {
      return new Quaternion(0, 0, 0, 1);
    }
    const inv = 1 / magnitude;
    return new Quaternion(-this.x * inv, -this.y * inv, -this.z * inv, this.w * inv);
  }

  static fromEuler(x: number, y: number, z: number): Quaternion {
    const cx = Math.cos(x * 0.5);
    const sx = Math.sin(x * 0.5);
    const cy = Math.cos(y * 0.5);
    const sy = Math.sin(y * 0.5);
    const cz = Math.cos(z * 0.5);
    const sz = Math.sin(z * 0.5);

    return new Quaternion(
      sx * cy * cz - cx * sy * sz,
      cx * sy * cz + sx * cy * sz,
      cx * cy * sz - sx * sy * cz,
      cx * cy * cz + sx * sy * sz,
    ).normalize();
  }

  rotateVector(vec: Vec3): Vec3 {
    const qVec = new Vec3(this.x, this.y, this.z);
    const uv = qVec.cross(vec);
    const uuv = qVec.cross(uv);
    uv.x *= 2 * this.w;
    uv.y *= 2 * this.w;
    uv.z *= 2 * this.w;
    uuv.x *= 2;
    uuv.y *= 2;
    uuv.z *= 2;
    return new Vec3(
      vec.x + uv.x + uuv.x,
      vec.y + uv.y + uuv.y,
      vec.z + uv.z + uuv.z,
    );
  }
}

export class Matrix4 {
  readonly elements: Float32Array;

  constructor(elements?: ArrayLike<number>) {
    this.elements = new Float32Array(16);
    if (elements) {
      this.elements.set(Array.from(elements).slice(0, 16));
    } else {
      this.identity();
    }
  }

  identity(): Matrix4 {
    const e = this.elements;
    e.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    return this;
  }

  multiply(other: Matrix4): Matrix4 {
    const a = this.elements;
    const b = other.elements;
    const result = new Float32Array(16);

    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        let sum = 0;
        for (let k = 0; k < 4; k += 1) {
          sum += a[row * 4 + k] * b[k * 4 + col];
        }
        result[row * 4 + col] = sum;
      }
    }

    return new Matrix4(result);
  }

  transformPoint(point: Vec3): Vec3 {
    const e = this.elements;
    const x = point.x;
    const y = point.y;
    const z = point.z;
    const w = 1;
    return new Vec3(
      e[0] * x + e[4] * y + e[8] * z + e[12] * w,
      e[1] * x + e[5] * y + e[9] * z + e[13] * w,
      e[2] * x + e[6] * y + e[10] * z + e[14] * w,
    );
  }

  static fromTranslationRotationScale(translation: Vec3, rotation: Quaternion, scale: Vec3): Matrix4 {
    const x = rotation.x;
    const y = rotation.y;
    const z = rotation.z;
    const w = rotation.w;
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;

    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;

    return new Matrix4([
      (1 - (yy + zz)) * scale.x,
      (xy + wz) * scale.x,
      (xz - wy) * scale.x,
      0,
      (xy - wz) * scale.y,
      (1 - (xx + zz)) * scale.y,
      (yz + wx) * scale.y,
      0,
      (xz + wy) * scale.z,
      (yz - wx) * scale.z,
      (1 - (xx + yy)) * scale.z,
      0,
      translation.x,
      translation.y,
      translation.z,
      1,
    ]);
  }
}

export class AABB {
  constructor(public min: Vec3 = new Vec3(Infinity, Infinity, Infinity), public max: Vec3 = new Vec3(-Infinity, -Infinity, -Infinity)) {}

  expand(point: Vec3): void {
    this.min.x = Math.min(this.min.x, point.x);
    this.min.y = Math.min(this.min.y, point.y);
    this.min.z = Math.min(this.min.z, point.z);
    this.max.x = Math.max(this.max.x, point.x);
    this.max.y = Math.max(this.max.y, point.y);
    this.max.z = Math.max(this.max.z, point.z);
  }

  containsPoint(point: Vec3): boolean {
    return point.x >= this.min.x && point.x <= this.max.x
      && point.y >= this.min.y && point.y <= this.max.y
      && point.z >= this.min.z && point.z <= this.max.z;
  }

  intersectsAABB(other: AABB): boolean {
    return this.min.x <= other.max.x && this.max.x >= other.min.x
      && this.min.y <= other.max.y && this.max.y >= other.min.y
      && this.min.z <= other.max.z && this.max.z >= other.min.z;
  }
}

export class Plane {
  constructor(public normal: Vec3 = new Vec3(0, 1, 0), public distance = 0) {}

  normalize(): Plane {
    const length = this.normal.length();
    if (length === 0) {
      return new Plane(new Vec3(0, 1, 0), 0);
    }
    const inv = 1 / length;
    return new Plane(this.normal.scale(inv), this.distance * inv);
  }

  distanceToPoint(point: Vec3): number {
    return this.normal.dot(point) + this.distance;
  }
}

export class Frustum {
  readonly planes: [Plane, Plane, Plane, Plane, Plane, Plane];

  constructor(planes?: [Plane, Plane, Plane, Plane, Plane, Plane]) {
    this.planes = planes ?? [new Plane(), new Plane(), new Plane(), new Plane(), new Plane(), new Plane()];
  }

  containsPoint(point: Vec3): boolean {
    for (const plane of this.planes) {
      if (plane.distanceToPoint(point) < 0) {
        return false;
      }
    }
    return true;
  }

  intersectsAABB(aabb: AABB): boolean {
    for (const plane of this.planes) {
      const p = new Vec3(
        plane.normal.x >= 0 ? aabb.max.x : aabb.min.x,
        plane.normal.y >= 0 ? aabb.max.y : aabb.min.y,
        plane.normal.z >= 0 ? aabb.max.z : aabb.min.z,
      );
      if (plane.distanceToPoint(p) < 0) {
        return false;
      }
    }
    return true;
  }
}

export class BoundingSphere {
  constructor(public center: Vec3 = new Vec3(0, 0, 0), public radius = 1) {}

  containsPoint(point: Vec3): boolean {
    return this.center.distance(point) <= this.radius;
  }

  intersectsAABB(aabb: AABB): boolean {
    let x = Math.max(aabb.min.x, Math.min(this.center.x, aabb.max.x));
    let y = Math.max(aabb.min.y, Math.min(this.center.y, aabb.max.y));
    let z = Math.max(aabb.min.z, Math.min(this.center.z, aabb.max.z));
    const dx = x - this.center.x;
    const dy = y - this.center.y;
    const dz = z - this.center.z;
    return (dx * dx + dy * dy + dz * dz) <= (this.radius * this.radius);
  }
}

export const SIMDGeometryLibrary = {
  Vec2,
  Vec3,
  Vec4,
  Quaternion,
  Matrix4,
  AABB,
  Plane,
  Frustum,
  BoundingSphere,
};

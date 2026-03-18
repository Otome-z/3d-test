import * as THREE from 'three'

export function directionFromPoints(from: THREE.Vector3, to: THREE.Vector3, target = new THREE.Vector3()) {
  return target.subVectors(to, from)
}

export function normalizedDirectionFromPoints(
  from: THREE.Vector3,
  to: THREE.Vector3,
  target = new THREE.Vector3()
) {
  return target.subVectors(to, from).normalize()
}

export function dotBetweenDirections(a: THREE.Vector3, b: THREE.Vector3) {
  return a.dot(b)
}

export function normalFromTriangle(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  target = new THREE.Vector3()
) {
  const ab = new THREE.Vector3().subVectors(b, a)
  const ac = new THREE.Vector3().subVectors(c, a)
  return target.copy(ab.cross(ac)).normalize()
}

export function planeFromTriangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
  return new THREE.Plane().setFromCoplanarPoints(a, b, c)
}

export function closestPointOnSegment(
  point: THREE.Vector3,
  start: THREE.Vector3,
  end: THREE.Vector3,
  clampToSegment = true,
  target = new THREE.Vector3()
) {
  return new THREE.Line3(start.clone(), end.clone()).closestPointToPoint(point, clampToSegment, target)
}

export function distancePointToSegment(point: THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3) {
  const closest = closestPointOnSegment(point, start, end, true, new THREE.Vector3())
  return {
    closest,
    distance: point.distanceTo(closest),
    distanceSq: point.distanceToSquared(closest)
  }
}

export function distancePointToPlane(point: THREE.Vector3, plane: THREE.Plane) {
  const projected = plane.projectPoint(point, new THREE.Vector3())
  return {
    projected,
    distanceSigned: plane.distanceToPoint(point),
    distance: Math.abs(plane.distanceToPoint(point))
  }
}

export function rayPlaneIntersection(ray: THREE.Ray, plane: THREE.Plane, target = new THREE.Vector3()) {
  return ray.intersectPlane(plane, target)
}

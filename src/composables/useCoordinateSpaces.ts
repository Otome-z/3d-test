import * as THREE from 'three'

export type CoordinateSnapshot = {
  local: THREE.Vector3
  world: THREE.Vector3
  view: THREE.Vector3
  ndc: THREE.Vector3
  screen: THREE.Vector2
  inClipRange: boolean
}

export function localToWorldPosition(
  object: THREE.Object3D,
  localPoint: THREE.Vector3,
  target = new THREE.Vector3()
) {
  object.updateWorldMatrix(true, false)
  return target.copy(localPoint).applyMatrix4(object.matrixWorld)
}

export function worldToLocalPosition(
  object: THREE.Object3D,
  worldPoint: THREE.Vector3,
  target = new THREE.Vector3()
) {
  object.updateWorldMatrix(true, false)
  return target.copy(worldPoint).applyMatrix4(new THREE.Matrix4().copy(object.matrixWorld).invert())
}

export function worldToViewPosition(
  worldPoint: THREE.Vector3,
  camera: THREE.Camera,
  target = new THREE.Vector3()
) {
  camera.updateMatrixWorld()
  return target.copy(worldPoint).applyMatrix4(camera.matrixWorldInverse)
}

export function worldToNdcPosition(
  worldPoint: THREE.Vector3,
  camera: THREE.Camera,
  target = new THREE.Vector3()
) {
  return target.copy(worldPoint).project(camera)
}

export function ndcToScreenPosition(
  ndcPoint: THREE.Vector3,
  rect: Pick<DOMRect, 'width' | 'height'>,
  target = new THREE.Vector2()
) {
  const x = (ndcPoint.x + 1) * 0.5 * rect.width
  const y = (1 - (ndcPoint.y + 1) * 0.5) * rect.height
  return target.set(x, y)
}

export function screenToNdcPosition(
  screenPoint: THREE.Vector2,
  rect: Pick<DOMRect, 'width' | 'height'>,
  target = new THREE.Vector3()
) {
  const x = (screenPoint.x / rect.width) * 2 - 1
  const y = -(screenPoint.y / rect.height) * 2 + 1
  return target.set(x, y, 0)
}

export function ndcToWorldPosition(
  ndcPoint: THREE.Vector3,
  camera: THREE.Camera,
  target = new THREE.Vector3()
) {
  return target.copy(ndcPoint).unproject(camera)
}

export function describeCoordinateSpaces(
  object: THREE.Object3D,
  localPoint: THREE.Vector3,
  camera: THREE.Camera,
  rect: Pick<DOMRect, 'width' | 'height'>
): CoordinateSnapshot {
  const world = localToWorldPosition(object, localPoint)
  const view = worldToViewPosition(world, camera)
  const ndc = worldToNdcPosition(world, camera)
  const screen = ndcToScreenPosition(ndc, rect)

  return {
    local: localPoint.clone(),
    world,
    view,
    ndc,
    screen,
    inClipRange:
      ndc.x >= -1 &&
      ndc.x <= 1 &&
      ndc.y >= -1 &&
      ndc.y <= 1 &&
      ndc.z >= -1 &&
      ndc.z <= 1
  }
}

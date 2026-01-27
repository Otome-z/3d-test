import { LoopSubdivision } from 'three-subdivide'
import type { BufferGeometry } from 'three'

export type SubdivideParams = {
  split?: boolean
  uvSmooth?: boolean
  preserveEdges?: boolean
  flatOnly?: boolean
  maxTriangles?: number
}

export default class SubdivisionModifier {
  subdivisions: number
  params: Required<SubdivideParams>

  constructor(subdivisions = 1, params: SubdivideParams = {}) {
    this.subdivisions = subdivisions
    this.params = {
      split: true,
      uvSmooth: false,
      preserveEdges: false,
      flatOnly: false,
      maxTriangles: Infinity,
      ...params,
    }
  }

  modify(geometry: BufferGeometry): BufferGeometry {
    return LoopSubdivision.modify(geometry, this.subdivisions, this.params)
  }
}

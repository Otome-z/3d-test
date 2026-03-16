// ======== IDs ========
export type VID = number
export type EID = number
export type FID = number
export type RVID = number // render vertex id
export type TID = number  // triangle id

// ======== Math structs (lightweight) ========
export type Vec3 = [number, number, number]
export type Vec2 = [number, number]

export type SelectionFlags = {
  selected?: boolean
  hidden?: boolean
  locked?: boolean
}

// ======== Logical Vertex (editable) ========
export interface EMVertex extends SelectionFlags {
  id: VID
  p: Vec3                 // logical position (the one you edit)
  edges: EID[]            // adjacency
  faces: FID[]            // adjacency
  // mapping to render vertices (multiple corners)
  rvs: RVID[]
}

// ======== Logical Edge ========
export interface EMEdge extends SelectionFlags {
  id: EID
  v0: VID
  v1: VID
  faces: FID[]            // 0,1,2... non-manifold allowed
  // for creases / hard edges
  sharp?: boolean         // if true: treat as hard edge
  crease?: number         // 0..1 (subdivision ready)
}

// ======== Face (polygon) ========
export interface EMFace extends SelectionFlags {
  id: FID
  // polygon loop in CCW order: these are logical vertex ids
  verts: VID[]

  // per-corner attributes:
  // corners[i] corresponds to verts[i]
  corners: EMCorner[]

  // derived cache
  normal?: Vec3           // face normal (flat)
  materialId?: number     // multi-material support
  smoothingGroup?: number // 3ds max style
}

export interface EMCorner {
  // each corner has its own UV and render vertex reference
  uv: Vec2
  rv: RVID
}

// ======== Render vertex (per-corner) ========
export interface EMRenderVertex {
  id: RVID
  v: VID        // which logical vertex it belongs to
  f: FID        // which face it belongs to (corner context)
  cornerIndex: number // index into face.verts / face.corners
  // baked attributes for GPU:
  p: Vec3       // usually same as logical vertex p (copied when building)
  n: Vec3       // computed from smoothing / sharp edges
  uv: Vec2
}

// ======== Triangles (GPU draw) ========
export interface EMTriangle {
  id: TID
  rv0: RVID
  rv1: RVID
  rv2: RVID
  face: FID
}

// ======== Main EditableMesh container ========
export interface EditableMesh {
  verts: EMVertex[]
  edges: EMEdge[]
  faces: EMFace[]

  // render layer
  rvs: EMRenderVertex[]
  tris: EMTriangle[]

  // topology maps (fast lookup)
  edgeMap: Map<string, EID>        // "vMin_vMax" -> edge id
  // optional: vertex position hash for welding
  posHash?: Map<string, VID[]>

  // dirty flags
  dirtyTopo: boolean
  dirtyPositions: boolean
  dirtyNormals: boolean
  dirtyUVs: boolean
}

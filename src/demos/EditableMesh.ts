import * as THREE from "three";

export type VertId = number;
export type EdgeId = number;
export type FaceId = number;

export type Tri = [VertId, VertId, VertId];

export class EMVertex {
  id: VertId;
  p: THREE.Vector3;
  edges: Set<EdgeId> = new Set();
  faces: Set<FaceId> = new Set();
  constructor(id: VertId, p: THREE.Vector3) {
    this.id = id;
    this.p = p;
  }
}

export class EMEdge {
  id: EdgeId;
  a: VertId; // smaller
  b: VertId; // larger
  faces: Set<FaceId> = new Set(); // 1 => boundary, 2 => manifold, >2 => non-manifold
  constructor(id: EdgeId, a: VertId, b: VertId) {
    this.id = id;
    this.a = a;
    this.b = b;
  }
  key() {
    return `${this.a}_${this.b}`;
  }
  isBoundary() {
    return this.faces.size === 1;
  }
  isManifold() {
    return this.faces.size === 2;
  }
}

export class EMFace {
  id: FaceId;
  v: Tri;
  edges: [EdgeId, EdgeId, EdgeId];
  constructor(id: FaceId, v: Tri, edges: [EdgeId, EdgeId, EdgeId]) {
    this.id = id;
    this.v = v;
    this.edges = edges;
  }
}

/**
 * Minimal EditableMesh:
 * - triangle faces
 * - undirected edges with face adjacency
 */
export class EditableMesh {
  vertices: EMVertex[] = [];
  edges: EMEdge[] = [];
  faces: EMFace[] = [];

  private edgeMap = new Map<string, EdgeId>(); // "a_b" -> edgeId

  // ---------- basics ----------
  addVertex(p: THREE.Vector3): VertId {
    const id = this.vertices.length;
    this.vertices.push(new EMVertex(id, p.clone()));
    return id;
  }

  private getOrCreateEdge(va: VertId, vb: VertId): EdgeId {
    const a = Math.min(va, vb);
    const b = Math.max(va, vb);
    const key = `${a}_${b}`;

    const existing = this.edgeMap.get(key);
    if (existing !== undefined) return existing;

    const id = this.edges.length;
    const e = new EMEdge(id, a, b);
    this.edges.push(e);
    this.edgeMap.set(key, id);

    this.vertices[a].edges.add(id);
    this.vertices[b].edges.add(id);

    return id;
  }

  addFaceTri(v0: VertId, v1: VertId, v2: VertId): FaceId {
    const id = this.faces.length;

    const e01 = this.getOrCreateEdge(v0, v1);
    const e12 = this.getOrCreateEdge(v1, v2);
    const e20 = this.getOrCreateEdge(v2, v0);

    const f = new EMFace(id, [v0, v1, v2], [e01, e12, e20]);
    this.faces.push(f);

    // link face <-> vertices
    this.vertices[v0].faces.add(id);
    this.vertices[v1].faces.add(id);
    this.vertices[v2].faces.add(id);

    // link face <-> edges
    this.edges[e01].faces.add(id);
    this.edges[e12].faces.add(id);
    this.edges[e20].faces.add(id);

    return id;
  }

  findEdgeByVerts(va: VertId, vb: VertId): EdgeId | null {
    const a = Math.min(va, vb);
    const b = Math.max(va, vb);
    const id = this.edgeMap.get(`${a}_${b}`);
    return id === undefined ? null : id;
  }

  // ---------- import/export ----------
  /**
   * Build EditableMesh from BufferGeometry.
   * - If geometry has no index, it will be treated as non-indexed triangles.
   * - Optional weld by position epsilon (for face-separated meshes).
   */
  static fromBufferGeometry(
    geo: THREE.BufferGeometry,
    opts?: { weld?: boolean; epsilon?: number }
  ): EditableMesh {
    const mesh = new EditableMesh();
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
    if (!posAttr) throw new Error("BufferGeometry has no position attribute");

    const weld = opts?.weld ?? false;
    const eps = opts?.epsilon ?? 1e-6;

    // Build vertex mapping
    const vertCount = posAttr.count;

    let indexArr: ArrayLike<number> | null = null;
    if (geo.index) indexArr = geo.index.array;

    // If no weld: 1:1 vertex
    if (!weld) {
      for (let i = 0; i < vertCount; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(posAttr, i);
        mesh.addVertex(p);
      }

      const triCount = indexArr ? (indexArr.length / 3) : (vertCount / 3);
      for (let t = 0; t < triCount; t++) {
        const i0 = indexArr ? indexArr[t * 3 + 0] : t * 3 + 0;
        const i1 = indexArr ? indexArr[t * 3 + 1] : t * 3 + 1;
        const i2 = indexArr ? indexArr[t * 3 + 2] : t * 3 + 2;
        mesh.addFaceTri(i0, i1, i2);
      }
      return mesh;
    }

    // weld by spatial hashing (minimal + fast)
    const cell = (v: number) => Math.round(v / eps);
    const keyOf = (p: THREE.Vector3) => `${cell(p.x)}|${cell(p.y)}|${cell(p.z)}`;

    const hash = new Map<string, VertId>();
    const oldToNew = new Array<VertId>(vertCount);

    for (let i = 0; i < vertCount; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(posAttr, i);
      const k = keyOf(p);
      const existing = hash.get(k);
      if (existing !== undefined) {
        oldToNew[i] = existing;
      } else {
        const vid = mesh.addVertex(p);
        hash.set(k, vid);
        oldToNew[i] = vid;
      }
    }

    const triCount = indexArr ? (indexArr.length / 3) : (vertCount / 3);
    for (let t = 0; t < triCount; t++) {
      const i0o = indexArr ? indexArr[t * 3 + 0] : t * 3 + 0;
      const i1o = indexArr ? indexArr[t * 3 + 1] : t * 3 + 1;
      const i2o = indexArr ? indexArr[t * 3 + 2] : t * 3 + 2;
      mesh.addFaceTri(oldToNew[i0o], oldToNew[i1o], oldToNew[i2o]);
    }

    return mesh;
  }

  /**
   * Export to BufferGeometry for rendering.
   * Minimal: triangulated, indexed.
   */
  toBufferGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(this.vertices.length * 3);
    for (let i = 0; i < this.vertices.length; i++) {
      const p = this.vertices[i].p;
      positions[i * 3 + 0] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    }

    const indices = new Uint32Array(this.faces.length * 3);
    for (let i = 0; i < this.faces.length; i++) {
      const [a, b, c] = this.faces[i].v;
      indices[i * 3 + 0] = a;
      indices[i * 3 + 1] = b;
      indices[i * 3 + 2] = c;
    }

    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    return geo;
  }

  // ---------- topology helpers ----------
  edgeVerts(eid: EdgeId): [VertId, VertId] {
    const e = this.edges[eid];
    return [e.a, e.b];
  }

  /**
   * Return the "other" vertex of edge given one endpoint.
   */
  otherVertOnEdge(eid: EdgeId, v: VertId): VertId {
    const e = this.edges[eid];
    if (e.a === v) return e.b;
    if (e.b === v) return e.a;
    throw new Error(`Vertex ${v} is not on edge ${eid}`);
  }

  /**
   * Minimal "edge loop" traversal.
   * Works best for quad-like regular topology:
   * - At each step, at the current vertex, choose the next edge by "straightest" direction
   *   (based on vertex positions), excluding the previous edge.
   *
   * For perfect modeling loops, later you should upgrade to half-edge + quad faces.
   */
  getEdgeLoop(startEdge: EdgeId, opts?: { maxSteps?: number; stopAtBoundary?: boolean }): EdgeId[] {
    const maxSteps = opts?.maxSteps ?? 10000;
    const stopAtBoundary = opts?.stopAtBoundary ?? true;

    const out: EdgeId[] = [];
    const visited = new Set<EdgeId>();

    // Walk in both directions and merge (common modeling behavior)
    const walkOneDir = (fromEdge: EdgeId, fromVert: VertId) => {
      let currentEdge = fromEdge;
      let currentVert = fromVert;
      let prevEdge: EdgeId | null = null;

      for (let step = 0; step < maxSteps; step++) {
        if (visited.has(currentEdge)) break;
        visited.add(currentEdge);
        out.push(currentEdge);

        const e = this.edges[currentEdge];
        if (stopAtBoundary && e.isBoundary()) break;

        const nextVert = this.otherVertOnEdge(currentEdge, currentVert);

        // choose next edge around nextVert
        const candidateEdges = [...this.vertices[nextVert].edges].filter((eid) => eid !== currentEdge);

        if (candidateEdges.length === 0) break;

        // direction vector of current edge (from nextVert backwards)
        const pNext = this.vertices[nextVert].p;
        const pCurr = this.vertices[currentVert].p;
        const dirIn = new THREE.Vector3().subVectors(pCurr, pNext).normalize();

        let bestEdge: EdgeId | null = null;
        let bestScore = -Infinity;

        for (const ceid of candidateEdges) {
          if (prevEdge !== null && ceid === prevEdge) continue;

          const ov = this.otherVertOnEdge(ceid, nextVert);
          const pOv = this.vertices[ov].p;
          const dirOut = new THREE.Vector3().subVectors(pOv, pNext).normalize();

          // prefer straight continuation: dot close to +1
          const score = dirIn.dot(dirOut);
          if (score > bestScore) {
            bestScore = score;
            bestEdge = ceid;
          }
        }

        if (bestEdge === null) break;

        prevEdge = currentEdge;
        currentEdge = bestEdge;
        currentVert = nextVert;

        // if we are back to first edge, stop
        if (currentEdge === fromEdge) break;
      }
    };

    const [a, b] = this.edgeVerts(startEdge);
    // walk from a->b and b->a
    walkOneDir(startEdge, a);

    // For opposite direction, reset visited to not immediately block; we want a full loop list
    // Minimal approach: do another walk and append unique ones
    const out2: EdgeId[] = [];
    const visited2 = new Set<EdgeId>();

    const walkOpp = (fromEdge: EdgeId, fromVert: VertId) => {
      let currentEdge = fromEdge;
      let currentVert = fromVert;
      let prevEdge: EdgeId | null = null;

      for (let step = 0; step < maxSteps; step++) {
        if (visited2.has(currentEdge)) break;
        visited2.add(currentEdge);
        out2.push(currentEdge);

        const e = this.edges[currentEdge];
        if (stopAtBoundary && e.isBoundary()) break;

        const nextVert = this.otherVertOnEdge(currentEdge, currentVert);
        const candidateEdges = [...this.vertices[nextVert].edges].filter((eid) => eid !== currentEdge);
        if (candidateEdges.length === 0) break;

        const pNext = this.vertices[nextVert].p;
        const pCurr = this.vertices[currentVert].p;
        const dirIn = new THREE.Vector3().subVectors(pCurr, pNext).normalize();

        let bestEdge: EdgeId | null = null;
        let bestScore = -Infinity;

        for (const ceid of candidateEdges) {
          if (prevEdge !== null && ceid === prevEdge) continue;

          const ov = this.otherVertOnEdge(ceid, nextVert);
          const pOv = this.vertices[ov].p;
          const dirOut = new THREE.Vector3().subVectors(pOv, pNext).normalize();
          const score = dirIn.dot(dirOut);
          if (score > bestScore) {
            bestScore = score;
            bestEdge = ceid;
          }
        }

        if (bestEdge === null) break;

        prevEdge = currentEdge;
        currentEdge = bestEdge;
        currentVert = nextVert;

        if (currentEdge === fromEdge) break;
      }
    };

    walkOpp(startEdge, b);

    // merge: out2 is opposite direction; remove duplicates and concatenate
    const set = new Set<EdgeId>(out);
    for (const e of out2) {
      if (!set.has(e)) out.push(e);
    }

    return out;
  }
}

// EditableMesh.ts
import * as THREE from "three";

/**
 * Complete EditableMesh:
 * - Logical topology: vertices / edges / triangle faces
 * - Per-corner attributes: uv + normal (solves same-position-different-face issue)
 * - Sharp edges + smoothing groups supported
 * - Import from BufferGeometry (indexed or non-indexed)
 * - Export to BufferGeometry (default: non-indexed for correctness)
 */

export type VertId = number;
export type EdgeId = number;
export type FaceId = number;

export type Tri = [VertId, VertId, VertId];

export type CornerIndex = 0 | 1 | 2;

export class EMVertex {
  id: VertId;
  p: THREE.Vector3;
  edges: Set<EdgeId> = new Set();
  faces: Set<FaceId> = new Set();

  /** render corners (face, corner) that reference this logical vertex */
  corners: Array<{ f: FaceId; c: CornerIndex }> = [];

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

  /** modeling flags */
  sharp = false; // hard edge flag (like "crease"/"hard edge")

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

  /** logical vertex ids (triangle) */
  v: Tri;

  /** edge ids aligned to (v0-v1, v1-v2, v2-v0) */
  edges: [EdgeId, EdgeId, EdgeId];

  /** per-corner UV */
  uv: [THREE.Vector2, THREE.Vector2, THREE.Vector2];

  /** per-corner normal (final, for rendering) */
  n: [THREE.Vector3, THREE.Vector3, THREE.Vector3];

  /** face normal (flat) cache */
  faceNormal: THREE.Vector3 = new THREE.Vector3();

  /** 3dsmax-like smoothing group (0 => always flat) */
  smoothingGroup = 1;

  /** optional material id */
  materialId = 0;

  constructor(
    id: FaceId,
    v: Tri,
    edges: [EdgeId, EdgeId, EdgeId],
    uv?: [THREE.Vector2, THREE.Vector2, THREE.Vector2]
  ) {
    this.id = id;
    this.v = v;
    this.edges = edges;
    this.uv = uv ?? [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()];
    this.n = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  }
}

/** helper: stable edge key */
function edgeKey(va: VertId, vb: VertId) {
  const a = Math.min(va, vb);
  const b = Math.max(va, vb);
  return `${a}_${b}`;
}

export class EditableMesh {
  vertices: EMVertex[] = [];
  edges: EMEdge[] = [];
  faces: EMFace[] = [];

  private edgeMap = new Map<string, EdgeId>(); // "a_b" -> edgeId

  // ---------- creation ----------
  addVertex(p: THREE.Vector3): VertId {
    const id = this.vertices.length;
    this.vertices.push(new EMVertex(id, p.clone()));
    return id;
  }

  private getOrCreateEdge(va: VertId, vb: VertId): EdgeId {
    const key = edgeKey(va, vb);
    const existing = this.edgeMap.get(key);
    if (existing !== undefined) return existing;

    const a = Math.min(va, vb);
    const b = Math.max(va, vb);

    const id = this.edges.length;
    const e = new EMEdge(id, a, b);
    this.edges.push(e);
    this.edgeMap.set(key, id);

    this.vertices[a].edges.add(id);
    this.vertices[b].edges.add(id);

    return id;
  }

  addFaceTri(
    v0: VertId,
    v1: VertId,
    v2: VertId,
    uv?: [THREE.Vector2, THREE.Vector2, THREE.Vector2]
  ): FaceId {
    const id = this.faces.length;

    const e01 = this.getOrCreateEdge(v0, v1);
    const e12 = this.getOrCreateEdge(v1, v2);
    const e20 = this.getOrCreateEdge(v2, v0);

    const f = new EMFace(id, [v0, v1, v2], [e01, e12, e20], uv);
    this.faces.push(f);

    // vertex <-> face adjacency
    this.vertices[v0].faces.add(id);
    this.vertices[v1].faces.add(id);
    this.vertices[v2].faces.add(id);

    // edge <-> face adjacency
    this.edges[e01].faces.add(id);
    this.edges[e12].faces.add(id);
    this.edges[e20].faces.add(id);

    // vertex corner references
    this.vertices[v0].corners.push({ f: id, c: 0 });
    this.vertices[v1].corners.push({ f: id, c: 1 });
    this.vertices[v2].corners.push({ f: id, c: 2 });

    return id;
  }

  findEdgeByVerts(va: VertId, vb: VertId): EdgeId | null {
    const id = this.edgeMap.get(edgeKey(va, vb));
    return id === undefined ? null : id;
  }

  edgeVerts(eid: EdgeId): [VertId, VertId] {
    const e = this.edges[eid];
    return [e.a, e.b];
  }

  otherVertOnEdge(eid: EdgeId, v: VertId): VertId {
    const e = this.edges[eid];
    if (e.a === v) return e.b;
    if (e.b === v) return e.a;
    throw new Error(`Vertex ${v} is not on edge ${eid}`);
  }

  // ---------- normals ----------
  /**
   * Compute flat face normals (per face)
   */
  computeFaceNormals(): void {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();

    for (const f of this.faces) {
      a.copy(this.vertices[f.v[0]].p);
      b.copy(this.vertices[f.v[1]].p);
      c.copy(this.vertices[f.v[2]].p);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      f.faceNormal.copy(ab.cross(ac).normalize());
    }
  }

  /**
   * Recompute per-corner normals:
   * - smoothingGroup = 0 => flat shading (corner normal = face normal)
   * - otherwise: for each logical vertex, average adjacent face normals that:
   *   (a) share the same smoothingGroup
   *   (b) are connected without crossing a sharp edge
   *
   * For sharp edges:
   * - if edge between two faces is sharp, normals should not be averaged across that edge.
   */
  recomputeCornerNormals(): void {
    this.computeFaceNormals();

    // quick map face->which corner uses a vertex
    // handled by EMVertex.corners already

    // For each vertex, we build groups of corners that can be smoothed together.
    // We do it by graph BFS over faces around this vertex, blocked by sharp edges or smoothingGroup mismatch.
    //
    // vertex-star graph nodes = faces incident to v
    // adjacency between two faces if they share an edge that also touches v AND that edge is not sharp.

    // precompute faceNeighborsAroundVertex[vId] on the fly per vertex (cheap)
    const faceNormal = new THREE.Vector3();
    const sum = new THREE.Vector3();

    for (const v of this.vertices) {
      if (v.faces.size === 0) continue;

      // Map: faceId -> set of neighbor faceIds (around this vertex, without crossing sharp edge)
      const neigh = new Map<FaceId, FaceId[]>();

      // build neighbors by scanning edges incident to v
      // each edge gives us a set of faces; those faces become neighbors among themselves (if edge not sharp)
      for (const eid of v.edges) {
        const e = this.edges[eid];
        if (e.sharp) continue; // block smoothing across this edge
        // edge must be incident to v (it is, because eid from v.edges)
        const faces = Array.from(e.faces);
        for (let i = 0; i < faces.length; i++) {
          for (let j = 0; j < faces.length; j++) {
            if (i === j) continue;
            const fi = faces[i];
            const fj = faces[j];
            if (!neigh.has(fi)) neigh.set(fi, []);
            neigh.get(fi)!.push(fj);
          }
        }
      }

      // Corner set grouped by smoothingGroup: we compute normals per connected component per smoothingGroup
      const visited = new Set<FaceId>();

      for (const fid of v.faces) {
        if (visited.has(fid)) continue;

        const f0 = this.faces[fid];
        const sg = f0.smoothingGroup;

        // smoothingGroup=0 => flat normals, mark visited and set corner normal directly
        if (sg === 0) {
          visited.add(fid);
          // set the corner normal for this vertex on this face
          const corner = this.findCornerIndexInFace(fid, v.id);
          if (corner !== null) {
            this.faces[fid].n[corner].copy(this.faces[fid].faceNormal);
          }
          continue;
        }

        // BFS for connected component of faces around this vertex with same smoothingGroup
        const queue: FaceId[] = [fid];
        const component: FaceId[] = [];
        visited.add(fid);

        while (queue.length) {
          const cur = queue.pop()!;
          component.push(cur);

          const nexts = neigh.get(cur) ?? [];
          for (const nf of nexts) {
            if (visited.has(nf)) continue;
            const fn = this.faces[nf];
            if (fn.smoothingGroup !== sg) continue; // do not smooth across different group
            // also must actually contain this vertex (safety, for non-manifold edge cases)
            if (!this.vertices[v.id].faces.has(nf)) continue;

            visited.add(nf);
            queue.push(nf);
          }
        }

        // average normals for this component
        sum.set(0, 0, 0);
        for (const cfid of component) {
          sum.add(this.faces[cfid].faceNormal);
        }
        if (sum.lengthSq() < 1e-20) {
          // fallback: use one face normal
          sum.copy(this.faces[fid].faceNormal);
        } else {
          sum.normalize();
        }

        // write to each face corner normal
        for (const cfid of component) {
          const corner = this.findCornerIndexInFace(cfid, v.id);
          if (corner !== null) {
            this.faces[cfid].n[corner].copy(sum);
          }
        }
      }
    }
  }

  private findCornerIndexInFace(fid: FaceId, vid: VertId): CornerIndex | null {
    const f = this.faces[fid];
    if (f.v[0] === vid) return 0;
    if (f.v[1] === vid) return 1;
    if (f.v[2] === vid) return 2;
    return null;
  }

  // ---------- import ----------
  /**
   * Build EditableMesh from BufferGeometry.
   *
   * Options:
   * - weldPositions: merge logical vertices by position epsilon (good for box-like / face-separated meshes)
   * - epsilon: welding tolerance
   *
   * Notes:
   * - If geometry has index, triangles come from index.
   * - If geometry has no index, triangles are consecutive triplets in position.
   * - UVs (if present) are read per-corner and preserved (no averaging).
   */
  static fromBufferGeometry(
    geo: THREE.BufferGeometry,
    opts?: { weldPositions?: boolean; epsilon?: number }
  ): EditableMesh {
    const mesh = new EditableMesh();
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
    if (!posAttr) throw new Error("BufferGeometry has no position attribute");

    const uvAttr = geo.getAttribute("uv") as THREE.BufferAttribute | undefined;

    const weld = opts?.weldPositions ?? false;
    const eps = opts?.epsilon ?? 1e-6;

    const vertCount = posAttr.count;

    // indices
    const indexArr: ArrayLike<number> | null = geo.index ? (geo.index.array as ArrayLike<number>) : null;
    const triCount = indexArr ? (indexArr.length / 3) : (vertCount / 3);

    // map from original vertex index -> logical vertex id
    const oldToNew = new Array<VertId>(vertCount);

    if (!weld) {
      for (let i = 0; i < vertCount; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(posAttr, i);
        oldToNew[i] = mesh.addVertex(p);
      }
    } else {
      // spatial hashing + bucket check
      const cell = (v: number) => Math.floor((v + eps * 0.5) / eps);
      const keyOf = (p: THREE.Vector3) => `${cell(p.x)}|${cell(p.y)}|${cell(p.z)}`;

      const buckets = new Map<string, VertId[]>();

      const tmp = new THREE.Vector3();

      for (let i = 0; i < vertCount; i++) {
        tmp.fromBufferAttribute(posAttr, i);
        const k = keyOf(tmp);
        const list = buckets.get(k);

        let found: VertId | null = null;
        if (list) {
          // verify by distance
          for (const cand of list) {
            const cp = mesh.vertices[cand].p;
            if (cp.distanceToSquared(tmp) <= eps * eps) {
              found = cand;
              break;
            }
          }
        }

        if (found !== null) {
          oldToNew[i] = found;
        } else {
          const vid = mesh.addVertex(tmp);
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k)!.push(vid);
          oldToNew[i] = vid;
        }
      }
    }

    // build faces with per-corner UV
    for (let t = 0; t < triCount; t++) {
      const i0 = indexArr ? indexArr[t * 3 + 0] : t * 3 + 0;
      const i1 = indexArr ? indexArr[t * 3 + 1] : t * 3 + 1;
      const i2 = indexArr ? indexArr[t * 3 + 2] : t * 3 + 2;

      const v0 = oldToNew[i0];
      const v1 = oldToNew[i1];
      const v2 = oldToNew[i2];

      let uv: [THREE.Vector2, THREE.Vector2, THREE.Vector2] | undefined;
      if (uvAttr) {
        uv = [
          new THREE.Vector2(uvAttr.getX(i0), uvAttr.getY(i0)),
          new THREE.Vector2(uvAttr.getX(i1), uvAttr.getY(i1)),
          new THREE.Vector2(uvAttr.getX(i2), uvAttr.getY(i2)),
        ];
      }

      mesh.addFaceTri(v0, v1, v2, uv);
    }

    // default normals
    mesh.recomputeCornerNormals();

    return mesh;
  }

  // ---------- export ----------
  /**
   * Export a renderable BufferGeometry.
   *
   * Default: non-indexed, because:
   * - per-corner uv/normals are preserved exactly
   * - easiest and safest for editors
   *
   * If you later need indexed export, we can add a (pos+uv+normal) dedup pass.
   */
  toBufferGeometryNonIndexed(): THREE.BufferGeometry {
    // ensure normals are ready
    this.recomputeCornerNormals();

    const triCount = this.faces.length;

    const positions = new Float32Array(triCount * 3 * 3);
    const normals = new Float32Array(triCount * 3 * 3);
    const uvs = new Float32Array(triCount * 3 * 2);

    let pi = 0;
    let ni = 0;
    let uvi = 0;

    for (const f of this.faces) {
      for (let c: CornerIndex = 0; c < 3; c = (c + 1) as CornerIndex) {
        const vid = f.v[c];
        const p = this.vertices[vid].p;
        const n = f.n[c];
        const uv = f.uv[c];

        positions[pi++] = p.x;
        positions[pi++] = p.y;
        positions[pi++] = p.z;

        normals[ni++] = n.x;
        normals[ni++] = n.y;
        normals[ni++] = n.z;

        uvs[uvi++] = uv.x;
        uvs[uvi++] = uv.y;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    return geo;
  }

  // ---------- editing helpers ----------
  setEdgeSharp(eid: EdgeId, sharp: boolean) {
    this.edges[eid].sharp = sharp;
  }

  setFaceSmoothingGroup(fid: FaceId, sg: number) {
    this.faces[fid].smoothingGroup = sg;
  }

  moveVertex(vid: VertId, delta: THREE.Vector3) {
    this.vertices[vid].p.add(delta);
  }

  // ---------- (optional) edge loop like your old version ----------
  /**
   * Minimal "edge loop" traversal by straightest continuation.
   * Works best for quad-like regular topology.
   */
  getEdgeLoop(startEdge: EdgeId, opts?: { maxSteps?: number; stopAtBoundary?: boolean }): EdgeId[] {
    const maxSteps = opts?.maxSteps ?? 10000;
    const stopAtBoundary = opts?.stopAtBoundary ?? true;

    const out: EdgeId[] = [];
    const visited = new Set<EdgeId>();

    const walkOneDir = (fromEdge: EdgeId, fromVert: VertId, outArr: EdgeId[], visitedSet: Set<EdgeId>) => {
      let currentEdge = fromEdge;
      let currentVert = fromVert;
      let prevEdge: EdgeId | null = null;

      for (let step = 0; step < maxSteps; step++) {
        if (visitedSet.has(currentEdge)) break;
        visitedSet.add(currentEdge);
        outArr.push(currentEdge);

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

          const score = dirIn.dot(dirOut); // prefer straight
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

    const [a, b] = this.edgeVerts(startEdge);

    // walk both directions and merge
    walkOneDir(startEdge, a, out, visited);

    const out2: EdgeId[] = [];
    const visited2 = new Set<EdgeId>();
    walkOneDir(startEdge, b, out2, visited2);

    const set = new Set(out);
    for (const e of out2) {
      if (!set.has(e)) out.push(e);
    }
    return out;
  }
}

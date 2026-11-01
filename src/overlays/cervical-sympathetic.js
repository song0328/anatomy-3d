// 목 교감신경줄기·신경절·교통가지 도식 (교과서 기준 배치, VMRA 그림 3-19). 왼쪽 도식을 정중면 거울로 오른쪽에도 그린다.
const MID = -0.1245
export default function build(ctx) {
  const { THREE } = ctx
  const D = ctx.R.overlayData?.['cervical-sympathetic']
  if (!D) return
  const V = (a) => new THREE.Vector3(...a)
  const mirrorM = new THREE.Matrix4().makeTranslation(MID, 0, 0).multiply(new THREE.Matrix4().makeScale(-1, 1, 1)).multiply(new THREE.Matrix4().makeTranslation(-MID, 0, 0))
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, emissive: '#000000', clippingPlanes: ctx.clipPlanes, side: THREE.DoubleSide, ...extra })
  const proxy = new THREE.MeshBasicMaterial({ visible: false })
  // 왼쪽 + 오른쪽(거울) 두 개를 같은 구조 id로 등록
  const both = (geo, proxyGeo, color, sid, extra) => {
    for (const mirror of [false, true]) {
      const g = mirror ? geo.clone().applyMatrix4(mirrorM) : geo
      const m = new THREE.Mesh(g, mat(color, extra))
      if (proxyGeo) { const p = new THREE.Mesh(mirror ? proxyGeo.clone().applyMatrix4(mirrorM) : proxyGeo, proxy); p.userData.proxyOf = m; m.add(p) }
      ctx.addMesh(m, { sid, cat: 'ganglion', layer: 'sympathetic' })
    }
  }
  const tube = (pts, r, color, sid, extra) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(V))
    both(new THREE.TubeGeometry(curve, Math.max(24, pts.length * 6), r, 8), new THREE.TubeGeometry(curve, 24, Math.max(r * 2.5, 0.014), 6), color, sid, extra)
  }
  tube(D.trunk, 0.0075, '#a9b3c6', 'trunk')
  for (const [id, g] of Object.entries(D.ganglia)) {
    const s = g.shape
    let geo
    if (s.kind === 'spindle') {
      const a = V(s.from), b = V(s.to), len = a.distanceTo(b)
      const prof = Array.from({ length: 29 }, (_, i) => { const t = i / 28; return new THREE.Vector2(Math.max(s.radius * Math.pow(Math.sin(Math.PI * t), 0.55), 0.0006), (t - 0.5) * len) })
      geo = new THREE.LatheGeometry(prof, 28)
      geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()))
      geo.translate(...a.clone().add(b).multiplyScalar(0.5).toArray())
    } else { geo = new THREE.SphereGeometry(1, 24, 16); geo.scale(...s.radii); geo.translate(...s.center) }
    both(geo, null, g.color, id)
    const c = s.kind === 'spindle' ? V(s.from).add(V(s.to)).multiplyScalar(0.5) : V(s.center)
    ctx.addLabel(g.label, c.add(new THREE.Vector3(-0.055, 0, 0.04)), 'ganglion', g.color, { layer: 'sympathetic', sid: id })
  }
  for (const r of D.grey) tube(r.curve, 0.0048, new THREE.Color(r.color).lerp(new THREE.Color('#9aa1ad'), 0.35), `grey-${r.nerve}`)
  for (const r of D.white) tube(r.curve, 0.0052, '#ffffff', `white-${r.nerve}`, { emissive: '#ffffff', emissiveIntensity: 0.2 })
  for (const b of D.other) tube(b.path, 0.0038, '#c4cad6', b.id)
  ctx.addLabel('C1–C8: 회색교통가지만 · 백색교통가지 없음 (VMRA 그림 3-19)', new THREE.Vector3(-0.45, 2.42, 0.12), 'note', undefined, { layer: 'sympathetic' })
}

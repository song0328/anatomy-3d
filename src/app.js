// 인체 해부 3D 학습 아틀라스 — 영역(region) 데이터를 불러와 3D·교재 그림·경로·퀴즈를 보여준다.
// 좌표계: BodyParts3D mm → (x, z, -y) × 0.008 (OrganUI spinal-cord-3d와 같음). +x = 몸의 왼쪽, +y = 위, +z = 앞.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

const $ = (s) => document.querySelector(s)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const V = (a) => new THREE.Vector3(...a)

export const CATS = {
  bone: { ko: '뼈', color: '#e7dfca', rough: 0.85 },
  'bone-feature': { ko: '뼈 부위', color: '#e7dfca', rough: 0.85 },
  'bone-space': { ko: '뼈의 구멍·관·오목', color: '#e7dfca', rough: 0.85 },
  joint: { ko: '관절', color: '#cfd8dc' },
  ligament: { ko: '인대', color: '#b9c7cf' },
  cartilage: { ko: '연골', color: '#9fc3d6' },
  muscle: { ko: '근육', color: '#b7685f' },
  tendon: { ko: '힘줄', color: '#d8c6a5' },
  fascia: { ko: '근막', color: '#c9b8a8', opacity: 0.4 },
  artery: { ko: '동맥', color: '#d0473c' },
  vein: { ko: '정맥', color: '#4a6fbf' },
  lymphatic: { ko: '림프', color: '#79c27a' },
  nerve: { ko: '신경', color: '#f0c64a' },
  ganglion: { ko: '신경절', color: '#ffad4d' },
  plexus: { ko: '신경얼기', color: '#e2b03c' },
  nucleus: { ko: '신경핵', color: '#b98bd9' },
  tract: { ko: '신경로', color: '#8fd3c8' },
  gyrus: { ko: '이랑', color: '#e9c2b4' },
  sulcus: { ko: '고랑', color: '#c9a294' },
  lobe: { ko: '엽', color: '#e2b8a8' },
  ventricle: { ko: '뇌실', color: '#62c0e0' },
  cistern: { ko: '수조', color: '#7fb6d0', opacity: 0.4 },
  meninx: { ko: '뇌척수막', color: '#c7b29a', opacity: 0.35 },
  brain: { ko: '뇌 구조', color: '#e3c6b7' },
  organ: { ko: '장기', color: '#c98a7a' },
  'organ-part': { ko: '장기 부위', color: '#c98a7a' },
  gland: { ko: '샘', color: '#d39fb0' },
  space: { ko: '공간', color: '#8aa0b4', opacity: 0.3 },
  region: { ko: '부위', color: '#8aa0b4', opacity: 0.3 },
  context: { ko: '주변 구조 (교재 미수록)', color: '#7d8590', opacity: 0.35 },
  sympathetic: { ko: '교감신경 도식', color: '#4f8cff' },
  other: { ko: '기타', color: '#aab2bd' },
}
const SRC = { VMRA: 'VMRA', NEURO: '신경해부 실습책' }
const REL = {
  partOf: '일부', branchOf: '가지 (부모)', continuesAs: '이어짐', innervatedBy: '신경 지배', suppliedBy: '혈액 공급', drainsTo: '배출',
  origin: '이는곳', insertion: '닿는곳', action: '작용', passesThrough: '지나는 곳', adjacentTo: '이웃', synapseIn: '시냅스',
  projectsTo: '투사', decussatesAt: '교차', contains: '포함', formedBy: '구성',
}

// ---------- 장면 ----------
const viewport = $('#viewport')
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false })
// 터치 기기(태블릿)는 메모리를 아끼려고 해상도 배율을 1.5까지만
renderer.setPixelRatio(Math.min(window.devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.5 : 2))
renderer.localClippingEnabled = true
renderer.outputColorSpace = THREE.SRGBColorSpace
viewport.appendChild(renderer.domElement)
const labelRenderer = new CSS2DRenderer()
labelRenderer.domElement.className = 'labels'
viewport.appendChild(labelRenderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#101318')
const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 200)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.minDistance = 0.15
controls.maxDistance = 40
scene.add(new THREE.HemisphereLight('#f4f1ea', '#2a2f38', 1.1))
const key = new THREE.DirectionalLight('#ffffff', 1.5)
scene.add(key)
const rim = new THREE.DirectionalLight('#9fb6ff', 0.6)
scene.add(rim)
const camLight = new THREE.DirectionalLight('#ffffff', 0.5)
scene.add(camLight)

// 단면(잘라 보기) 평면
const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6)
const clipPlanes = [clipPlane]
let clipOn = false

// ---------- 상태 ----------
let INDEX = null
let R = null // 현재 영역 데이터
const root = new THREE.Group()
scene.add(root)
const labelsGroup = new THREE.Group()
scene.add(labelsGroup)
let meshes = [] // 모든 표시 메시
const bySid = new Map() // 구조 id → [mesh]
const pickables = []
let selected = null
let activePath = null
let figureFocus = null
let mode = 'explore'
const overlayCleanups = []

const loader = new GLTFLoader()
const fetchJson = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u} ${r.status}`); return r.json() })

function material(cat, extra = {}) {
  const c = CATS[cat] ?? CATS.other
  const opacity = extra.opacity ?? c.opacity ?? 1
  return new THREE.MeshStandardMaterial({
    color: extra.color ?? c.color, roughness: c.rough ?? 0.6, metalness: 0,
    transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
    side: opacity < 1 ? THREE.DoubleSide : THREE.FrontSide, clippingPlanes: clipPlanes,
  })
}

// ---------- 영역 불러오기 ----------
async function loadRegion(id, opts = {}) {
  setLoading(`${INDEX.regions.find((r) => r.id === id)?.ko ?? id} 불러오는 중…`)
  clearRegion()
  R = await fetchJson(`public/data/${id}.json`)
  document.querySelectorAll('[data-region]').forEach((b) => b.classList.toggle('active', b.dataset.region === id))
  const gltf = await new Promise((res, rej) => loader.load(`public/models/${R.model}`, res, undefined, rej))
  gltf.scene.updateMatrixWorld(true)
  const list = []
  gltf.scene.traverse((o) => { if (o.isMesh) list.push(o) })
  for (const m of list) {
    const p = R.parts[m.name] ?? R.parts[m.parent?.name]
    if (!p) continue
    m.geometry.applyMatrix4(m.matrixWorld)
    m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1)
    m.geometry.computeVertexNormals()
    m.geometry.computeBoundingBox()
    const st = R.structures[p.s]
    const cat = p.cat ?? st?.cat ?? 'context'
    m.material = material(cat, { color: p.color })
    m.userData = { sid: p.s, cat, layer: p.layer ?? cat, part: m.name, baseColor: m.material.color.clone(), baseOpacity: m.material.opacity }
    root.add(m)
    meshes.push(m)
    if (p.s) { if (!bySid.has(p.s)) bySid.set(p.s, []); bySid.get(p.s).push(m) }
    pickables.push(m)
  }
  for (const ov of R.overlays ?? []) {
    try {
      const mod = await import(`./overlays/${ov}.js`)
      const cleanup = await mod.default(ctx)
      if (cleanup) overlayCleanups.push(cleanup)
    } catch (e) { console.error('overlay', ov, e) }
  }
  buildLayers()
  buildFigures()
  buildPathways()
  buildSections()
  resetQuiz()
  if (document.querySelector(`[data-mode="${mode}"]`)?.hidden) setMode('explore')
  fitAll(R.views?.default)
  setLoading(null)
  if (opts.select) focusOn(opts.select)
  else renderInfo(null)
  try { localStorage.setItem('atlas.region', id) } catch {}
}

function clearRegion() {
  clearFlow()
  figLabels.length = 0
  clearClip()
  for (const k of ['#figDetail', '#pathDetail', '#sectionDetail']) $(k).innerHTML = ''
  try { $('#clipRange').value = 1 } catch {}
  for (const c of overlayCleanups.splice(0)) try { c() } catch {}
  for (const m of meshes) { m.geometry.dispose(); m.material.dispose() }
  root.clear(); labelsGroup.clear()
  meshes = []; bySid.clear(); pickables.length = 0
  selected = null; figureFocus = null
}

// 겹쳐 그리는 도식(overlay) 모듈이 쓰는 도구
export const ctx = {
  THREE, scene: root, labels: labelsGroup, clipPlanes,
  get R() { return R },
  partMeshes: (sid) => bySid.get(sid) ?? [],
  material,
  addMesh(mesh, { sid, cat = 'other', layer, pick = true }) {
    mesh.userData = { ...mesh.userData, sid, cat, layer: layer ?? cat, baseColor: mesh.material.color?.clone(), baseOpacity: mesh.material.opacity, overlay: true }
    root.add(mesh); meshes.push(mesh)
    if (sid) { if (!bySid.has(sid)) bySid.set(sid, []); bySid.get(sid).push(mesh) }
    if (pick) pickables.push(mesh)
    return mesh
  },
  addLabel(text, pos, cls = 'note', color, opt = {}) {
    const el = document.createElement('div')
    el.className = `tag tag-${cls}`
    el.textContent = text
    if (color) el.style.setProperty('--c', color)
    const o = new CSS2DObject(el)
    o.position.copy(pos)
    o.userData = { layer: opt.layer, sid: opt.sid }
    labelsGroup.add(o)
    applyLabelVisibility()
    return o
  },
  centroidOf,
}

// ---------- 레이어 ----------
const hiddenLayers = new Set()
function buildLayers() {
  const counts = {}
  for (const m of meshes) counts[m.userData.layer] = (counts[m.userData.layer] ?? 0) + 1
  hiddenLayers.clear()
  for (const l of R.hiddenLayers ?? []) hiddenLayers.add(l)
  const order = Object.keys(CATS)
  const layers = Object.keys(counts).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
  $('#layers').innerHTML = layers.map((l) => `
    <label class="toggle"><input type="checkbox" data-layer="${l}" ${hiddenLayers.has(l) ? '' : 'checked'}>
    <i style="background:${(CATS[l] ?? CATS.other).color}"></i><span>${esc(R.layerNames?.[l] ?? (CATS[l] ?? CATS.other).ko)}</span><em>${counts[l]}</em></label>`).join('') +
    `<label class="toggle"><input type="checkbox" data-layer="__labels" checked><i></i><span>이름표</span></label>`
  applyVisibility()
}
$('#layers').addEventListener('change', (e) => {
  const l = e.target.dataset.layer
  if (!l) return
  if (l === '__labels') { labelsGroup.visible = e.target.checked; return }
  e.target.checked ? hiddenLayers.delete(l) : hiddenLayers.add(l)
  applyVisibility()
})
function applyVisibility() {
  for (const m of meshes) m.visible = !hiddenLayers.has(m.userData.layer)
  if (figureFocus) applyFigureFocus()
  applyLabelVisibility()
}
// 이름표: 자기 레이어가 꺼지면 숨기고, 교재 그림 모드에서는 그림에 없는 구조의 이름표를 숨긴다
// 교감신경 도식 이름표는 처음엔 숨기고, 도식 구조를 골랐거나 그 구조가 든 경로를 볼 때만 보인다
const isSym = (sid) => (bySid.get(sid) ?? []).some((m) => m.userData.layer === 'sympathetic')
function applyLabelVisibility() {
  const inFig = figureFocus ? new Set(figureFocus.structures.flatMap((x) => [x, ...stand(x), ...membersOf(x)])) : null
  const symOn = !!inFig || (selected && isSym(selected)) || !!activePath?.steps.some((s) => s.s && isSym(s.s))
  for (const o of labelsGroup.children) {
    const { layer, sid } = o.userData ?? {}
    let v = !(layer && hiddenLayers.has(layer))
    if (v && layer === 'sympathetic' && !symOn) v = false
    if (v && inFig && sid && !inFig.has(sid)) v = false
    if (v && inFig && !sid && layer) v = false
    o.visible = v
  }
}
function ensureVisible(sid) {
  for (const m of bySid.get(sid) ?? []) {
    if (hiddenLayers.has(m.userData.layer)) {
      hiddenLayers.delete(m.userData.layer)
      const cb = document.querySelector(`[data-layer="${m.userData.layer}"]`)
      if (cb) cb.checked = true
    }
  }
  applyVisibility()
}

// ---------- 선택·강조 ----------
const stand = (sid, depth = 0) => {
  const st = R?.structures[sid]
  const out = []
  for (const x of [...(st?.within ?? []), ...(st?.between ?? [])]) {
    if (bySid.has(x)) out.push(x)
    else if (depth < 2) out.push(...(R.structures[x]?.members ?? []).filter((y) => bySid.has(y)), ...stand(x, depth + 1))
  }
  return [...new Set(out)]
}
const membersOf = (sid) => (R?.structures[sid]?.members ?? []).filter((x) => bySid.has(x))
const hasOwn = (sid) => bySid.get(sid)?.length || membersOf(sid).length
const meshesFor = (sid) => (bySid.get(sid)?.length ? bySid.get(sid) : membersOf(sid).length ? membersOf(sid).flatMap((x) => bySid.get(x)) : stand(sid).flatMap((x) => bySid.get(x)))
function relatedIds(sid) {
  const st = R.structures[sid]
  const out = new Set([sid])
  for (const r of st?.rel ?? []) if (R.structures[r.target] && ['innervatedBy', 'suppliedBy', 'branchOf', 'synapseIn', 'drainsTo'].includes(r.type)) out.add(r.target)
  for (const c of st?.children ?? []) out.add(c)
  for (const c of st?.members ?? []) out.add(c)
  return out
}
function paint() {
  const rel = selected ? relatedIds(selected) : new Set()
  const ghost = new Set(selected && !hasOwn(selected) ? stand(selected) : [])
  for (const m of meshes) {
    const mat = m.material
    if (!mat.emissive) continue
    const g = ghost.has(m.userData.sid)
    const on = rel.has(m.userData.sid)
    mat.emissive.set(g ? '#4cc9f0' : on ? '#ffc94d' : '#000000')
    mat.emissiveIntensity = g ? 0.5 : on ? (m.userData.sid === selected ? 0.45 : 0.22) : 0
  }
}
function select(sid, { fly = false } = {}) {
  selected = sid && R.structures[sid] ? sid : null
  applyLabelVisibility()
  paint()
  renderInfo(selected)
  if (fly && selected) flyTo(meshesFor(selected))
}

const regionName = (id) => INDEX?.regions.find((r) => r.id === id)?.ko ?? id
function findElsewhere(target) {
  const k = norm(target)
  return INDEX?.search.find((e) => e.id === target && e.r !== R.id) ?? INDEX?.search.find((e) => e.r !== R.id && (e.t === k || e.e === k)) ?? null
}
function renderInfo(sid) {
  const box = $('#info')
  if (!sid && innerWidth < 900) { box.hidden = true; return } // 좁은 화면: 구조를 골랐을 때만 정보 창
  if (!sid) {
    box.innerHTML = R ? `<h2>${esc(R.ko)}</h2><p class="sub">${esc(R.en ?? '')}</p>${(R.intro ?? []).map((p) => `<p>${esc(p)}</p>`).join('')}
      ${(R.mnemonics ?? []).length ? `<details><summary>교재 암기법 ${R.mnemonics.length}개</summary>${R.mnemonics.map((m) => `<p class="tip-card">💡 ${esc(m.text)} <small class="src">${esc(m.ref)}</small></p>`).join('')}</details>` : ''}
      <p class="muted">구조 ${Object.keys(R.structures).length}개 · 3D ${[...bySid.keys()].length}개 · 교재 그림 ${R.figures.length}개</p>` : ''
    box.hidden = !R
    return
  }
  const st = R.structures[sid]
  const parts = (bySid.get(sid)?.length ?? 0) + membersOf(sid).length
  const figs = (st.figs ?? []).map((f) => `<button class="fig-chip" data-fig="${esc(f.src)}|${esc(f.fig)}|${f.page}">${esc(SRC[f.src] ?? f.src)} 그림 ${esc(f.fig)}</button>`).join('')
  const rels = (st.rel ?? []).map((r) => {
    const t = R.structures[r.target]
    const other = !t && findElsewhere(r.target)
    const label = t ? `<button class="chip-btn" data-select="${esc(r.target)}">${esc(t.ko || t.en)}</button>`
      : other ? `<button class="chip-btn" data-goto="${esc(other.r)}|${esc(other.id)}">${esc(other.ko)} <small>→ ${esc(regionName(other.r))}</small></button>`
      : `<span class="chip-plain">${esc(r.target)}</span>`
    return `<li><b>${esc(REL[r.type] ?? r.type)}</b> ${label}${r.ref ? ` <small>${esc(r.ref)}</small>` : ''}</li>`
  }).join('')
  box.hidden = false
  box.innerHTML = `
    <button class="close" aria-label="닫기" data-close>×</button>
    <h2>${esc(st.ko || st.en)}</h2>
    <p class="sub">${esc(st.en ?? '')}${st.aliases?.length ? ` · ${esc(st.aliases.slice(0, 4).join(', '))}` : ''}</p>
    <div class="tags"><span>${esc((CATS[st.cat] ?? CATS.other).ko)}</span>${parts ? '' : stand(sid).length ? `<span class="ghost-tag">3D 없음 · ${st.within?.length ? '하늘색 구조 안에 있어요' : '하늘색 주변·구성 구조로 보여줘요'}</span>` : '<span class="warn">3D 모델 없음 · 교재 그림으로 확인</span>'}${st.schematic ? '<span class="warn">도식</span>' : ''}${st.koUncertain ? '<span class="warn">한글 용어 확인 필요</span>' : ''}</div>
    ${(st.facts ?? []).map((f) => `<p>${esc(f.t)} <small class="src">${esc(SRC[f.src] ?? f.src)}</small></p>`).join('')}
    ${st.extra?.length ? `<details><summary>교재 밖 참고</summary>${st.extra.map((t) => `<p class="muted">${esc(t)}</p>`).join('')}</details>` : ''}
    ${rels ? `<ul class="rels">${rels}</ul>` : ''}
    ${figs ? `<div class="figs"><span>교재에서 보기</span>${figs}</div>` : ''}
    ${!parts && stand(sid).length ? `<p class="muted">${st.within?.length ? '들어 있는 구조' : '주변·구성 구조'}: ${stand(sid).map((x) => `<button class="chip-btn" data-select="${esc(x)}">${esc(R.structures[x]?.ko || R.structures[x]?.en || x)}</button>`).join(' ')}</p>` : ''}
    ${membersOf(sid).length ? `<p class="muted">구성 구조: ${membersOf(sid).map((x) => `<button class="chip-btn" data-select="${esc(x)}">${esc(R.structures[x]?.ko || R.structures[x]?.en || x)}</button>`).join(' ')}</p>` : ''}
    ${st.mapNote ? `<p class="muted">${esc(st.mapNote)}</p>` : ''}
    ${st.parts3d ? `<p class="muted">3D: ${esc(st.parts3d)}</p>` : ''}`
}

// ---------- 교재 그림 ----------
function buildFigures() {
  const src = R.figures
  const groups = {}
  for (const f of src) (groups[f.src] ??= []).push(f)
  $('#figList').innerHTML = Object.entries(groups).map(([s, fs]) => `
    <h4>${esc(SRC[s] ?? s)}</h4>
    ${fs.map((f, i) => `<button class="fig-row" data-figrow="${esc(s)}|${esc(f.fig)}"><b>${esc(f.fig)}</b><span>${esc(f.title || '')}</span><em>${f.structures.filter((x) => bySid.has(x)).length}/${f.structures.length + (f.missing?.length ?? 0)}</em></button>`).join('')}`).join('')
}
const figLabels = []
function clearFigLabels() { for (const o of figLabels.splice(0)) { o.element.remove(); labelsGroup.remove(o) } }
function showFigure(src, fig) {
  clearFigLabels()
  if (!bookEl.hidden) { const f0 = R.figures.find((x) => x.src === src && x.fig === fig); if (f0) openTextbook(src, fig, f0.page) }
  const f = R.figures.find((x) => x.src === src && x.fig === fig)
  if (!f) return
  figureFocus = f
  document.querySelectorAll('.fig-row').forEach((b) => b.classList.toggle('active', b.dataset.figrow === `${src}|${fig}`))
  for (const sid of f.structures) ensureVisible(sid)
  applyFigureFocus()
  const ms = f.structures.flatMap((s) => meshesFor(s))
  if (ms.length) {
    // 너무 긴 구조(척수, 긴 신경 등)는 시점 계산에서 뺀다
    const diag = (m) => { m.geometry.computeBoundingBox(); return m.geometry.boundingBox.getSize(new THREE.Vector3()).length() }
    const ds = ms.map(diag).sort((a, b) => a - b)
    const med = ds[Math.floor(ds.length / 2)]
    const core = ms.filter((m) => diag(m) <= Math.max(med * 4, 0.3))
    flyTo(core.length ? core : ms)
  }
  const camAt = camTween ? camTween.toP.clone() : camera.position.clone()
  for (const s of f.structures.slice(0, 40)) {
    const own = bySid.get(s)
    if (!own?.length) continue
    const st = R.structures[s]
    const near = own.map((m) => [m, centroidOf([m])]).sort((a, b) => a[1].distanceTo(camAt) - b[1].distanceTo(camAt))[0]
    figLabels.push(ctx.addLabel(st.ko || st.en, near[1], 'fig'))
  }
  // 그림 속 구조 목록 + 교재 이미지
  const items = f.structures.map((s) => {
    const st = R.structures[s]
    const has = hasOwn(s)
    return `<button class="chip-btn ${has ? '' : stand(s).length ? 'stand' : 'nomesh'}" data-select="${esc(s)}">${esc(st?.ko || st?.en || s)}</button>`
  }).join('') + (f.missing ?? []).map((m) => `<span class="chip-plain nomesh">${esc(m)}</span>`).join('')
  $('#figDetail').innerHTML = `<h4>${esc(SRC[src] ?? src)} 그림 ${esc(fig)} <small>${esc(f.title || '')}</small></h4>
    <div class="fig-items">${items}</div>
    <button class="ghost" data-fig="${esc(src)}|${esc(fig)}|${f.page}">교재 그림 창 열기</button>
    <button class="ghost" data-figclear>강조 해제</button>
    ${(R.mnemonics ?? []).filter((m) => m.src === src && m.fig === fig).map((m) => `<p class="tip-card">💡 ${esc(m.text)}</p>`).join('')}
    <p class="hint">흐린 칩은 3D 모델이 없는 구조예요. 교재 그림으로 확인하세요.</p>${ms.length ? '' : '<p class="hint warn-text">이 그림은 개념·발생 그림이라 3D로 대응하는 구조가 없어요. 교재 그림 창으로 보세요.</p>'}`
}
function applyFigureFocus() {
  queueMicrotask(applyLabelVisibility)
  const on = new Set(figureFocus?.structures ?? [])
  for (const s of figureFocus?.structures ?? []) { for (const x of membersOf(s)) on.add(x); if (!hasOwn(s)) for (const x of stand(s)) on.add(x) }
  for (const m of meshes) {
    const inFig = on.has(m.userData.sid)
    const mat = m.material
    if (!figureFocus) { mat.opacity = m.userData.baseOpacity; mat.color.copy(m.userData.baseColor) }
    else if (inFig) { mat.opacity = Math.max(m.userData.baseOpacity, 0.95); mat.color.copy(m.userData.baseColor) }
    else { mat.opacity = Math.min(m.userData.baseOpacity, 0.12); mat.color.copy(m.userData.baseColor).lerp(new THREE.Color('#8b939e'), 0.6) }
    mat.transparent = mat.opacity < 1
    mat.depthWrite = !mat.transparent
    mat.needsUpdate = true
  }
}
function clearFigure() {
  clearFigLabels()
  figureFocus = null
  applyLabelVisibility()
  document.querySelectorAll('.fig-row').forEach((b) => b.classList.remove('active'))
  $('#figDetail').innerHTML = ''
  applyFigureFocus()
}
// ---------- 교재 그림 창 (떠 있는 창: 이동·크기·확대) ----------
let FIGPOS = { VMRA: {}, NEURO: {} }
const book = { src: null, fig: null, page: null, mode: 'fig', scale: 1, tx: 0, ty: 0, iw: 1, ih: 1 }
const bookEl = $('#book'), bookBody = $('#bookBody'), bookCanvas = $('#bookCanvas'), bookImg = $('#bookImg'), bookMark = $('#bookMark')
const pagePath = (src, page) => (src === 'NEURO' ? `public/textbook/neuro/p${String(page).padStart(2, '0')}.png` : `public/textbook/vmra/p${String(page).padStart(3, '0')}.png`)
function bookWinRestore() {
  let w = { w: Math.min(480, innerWidth - 24), h: Math.min(560, innerHeight - 140) }
  w.x = innerWidth - w.w - 16; w.y = 104
  if (innerWidth < 900) w = { x: 8, y: 60, w: innerWidth - 16, h: Math.round(innerHeight * 0.42) }
  try { const sv = JSON.parse(localStorage.getItem('atlas.bookwin') || 'null'); if (sv) w = sv } catch {}
  placeBookWin(w)
}
function placeBookWin(w) {
  const W = Math.max(240, Math.min(w.w, innerWidth - 8)), H = Math.max(180, Math.min(w.h, innerHeight - 8))
  const X = Math.max(80 - W, Math.min(w.x, innerWidth - 80)), Y = Math.max(0, Math.min(w.y, innerHeight - 40))
  Object.assign(bookEl.style, { left: `${X}px`, top: `${Y}px`, width: `${W}px`, height: `${H}px` })
}
function saveBookWin() {
  const r = bookEl.getBoundingClientRect()
  try { localStorage.setItem('atlas.bookwin', JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height })) } catch {}
}
function applyBook() { bookCanvas.style.transform = `translate(${book.tx}px, ${book.ty}px) scale(${book.scale})` }
function fitBook() {
  const bw = bookBody.clientWidth, bh = bookBody.clientHeight
  book.scale = Math.min(bw / book.iw, bh / book.ih) * 0.98
  book.tx = (bw - book.iw * book.scale) / 2; book.ty = (bh - book.ih * book.scale) / 2
  // 쪽 전체 보기에서는 그림 위치를 화면 가운데로 확대
  const fp = FIGPOS[book.src]?.[book.fig]
  if (book.mode === 'page' && fp && fp.page === +book.page) {
    const rw = (fp.x1 - fp.x0) * book.iw, rh = (fp.y1 - fp.y0) * book.ih
    book.scale = Math.min(bw / rw, bh / rh) * 0.9
    book.tx = bw / 2 - (fp.x0 * book.iw + rw / 2) * book.scale
    book.ty = bh / 2 - (fp.y0 * book.ih + rh / 2) * book.scale
  }
  applyBook()
}
function zoomBook(f, cx = bookBody.clientWidth / 2, cy = bookBody.clientHeight / 2) {
  const ns = THREE.MathUtils.clamp(book.scale * f, 0.05, 12)
  book.tx = cx - (cx - book.tx) * (ns / book.scale); book.ty = cy - (cy - book.ty) * (ns / book.scale)
  book.scale = ns; applyBook()
}
function loadBookImage() {
  const fp = FIGPOS[book.src]?.[book.fig]
  if (book.mode === 'fig' && !fp) book.mode = 'page'
  document.querySelectorAll('[data-bk=fig]').forEach((b) => { b.disabled = !fp; b.classList.toggle('active', book.mode === 'fig') })
  document.querySelectorAll('[data-bk=page]').forEach((b) => b.classList.toggle('active', book.mode === 'page'))
  const url = book.mode === 'fig' ? `public/textbook/figs/${book.src}_${book.fig}.png` : pagePath(book.src, book.page)
  bookImg.onload = () => {
    book.iw = bookImg.naturalWidth; book.ih = bookImg.naturalHeight
    if (book.mode === 'page' && fp && fp.page === +book.page) {
      Object.assign(bookMark.style, { left: `${fp.x0 * book.iw}px`, top: `${fp.y0 * book.ih}px`, width: `${(fp.x1 - fp.x0) * book.iw}px`, height: `${(fp.y1 - fp.y0) * book.ih}px` })
      bookMark.hidden = false
    } else bookMark.hidden = true
    fitBook()
  }
  bookImg.src = url
}
function openTextbook(src, fig, page) {
  const fp = FIGPOS[src]?.[fig]
  book.src = src; book.fig = fig; book.page = +(fp?.page ?? page)
  if (!fp) book.mode = 'page'
  else if (book.mode !== 'page') book.mode = 'fig'
  const pg = book.page
  $('#bookTitle').textContent = `${SRC[src] ?? src} · 그림 ${fig} · ${src === 'VMRA' && pg >= 12 ? `책 ${pg - 11}쪽` : `${pg}쪽`}`
  if (bookEl.hidden) { bookEl.hidden = false; if (!bookEl.style.width) bookWinRestore() }
  loadBookImage()
}
// 창 이동 (제목줄 끌기)
$('#bookHead').addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return
  const r = bookEl.getBoundingClientRect(), sx = e.clientX, sy = e.clientY
  const move = (ev) => placeBookWin({ x: r.left + ev.clientX - sx, y: r.top + ev.clientY - sy, w: r.width, h: r.height })
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); saveBookWin() }
  addEventListener('pointermove', move); addEventListener('pointerup', up)
})
// 크기 조절 (오른쪽 아래 모서리 끌기)
$('#bookResize').addEventListener('pointerdown', (e) => {
  e.preventDefault()
  const r = bookEl.getBoundingClientRect(), sx = e.clientX, sy = e.clientY
  const move = (ev) => placeBookWin({ x: r.left, y: r.top, w: r.width + ev.clientX - sx, h: r.height + ev.clientY - sy })
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); saveBookWin() }
  addEventListener('pointermove', move); addEventListener('pointerup', up)
})
// 그림 확대(휠·두 손가락)·이동(끌기)·맞춤(두 번 클릭)
bookBody.addEventListener('wheel', (e) => {
  e.preventDefault()
  const r = bookBody.getBoundingClientRect()
  zoomBook(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top)
}, { passive: false })
const bookPtrs = new Map()
let pinch = null
bookBody.addEventListener('pointerdown', (e) => {
  bookBody.setPointerCapture(e.pointerId)
  bookPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY })
  bookBody.classList.add('dragging')
  if (bookPtrs.size === 2) { const [a, b] = [...bookPtrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) } }
})
bookBody.addEventListener('pointermove', (e) => {
  const prev = bookPtrs.get(e.pointerId)
  if (!prev) return
  bookPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (bookPtrs.size === 2 && pinch) {
    const [a, b] = [...bookPtrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), r = bookBody.getBoundingClientRect()
    zoomBook(d / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); pinch.d = d
  } else if (bookPtrs.size === 1) { book.tx += e.clientX - prev.x; book.ty += e.clientY - prev.y; applyBook() }
})
const endPtr = (e) => { bookPtrs.delete(e.pointerId); if (bookPtrs.size < 2) pinch = null; if (!bookPtrs.size) bookBody.classList.remove('dragging') }
bookBody.addEventListener('pointerup', endPtr)
bookBody.addEventListener('pointercancel', endPtr)
bookBody.addEventListener('dblclick', fitBook)
document.querySelector('.book-tools').addEventListener('click', (e) => {
  const k = e.target.closest('button')?.dataset.bk
  if (!k) return
  if (k === 'close') bookEl.hidden = true
  if (k === 'in') zoomBook(1.25)
  if (k === 'out') zoomBook(1 / 1.25)
  if (k === 'fit') fitBook()
  if (k === 'fig' || k === 'page') { book.mode = k; loadBookImage() }
})
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !bookEl.hidden && document.activeElement !== $('#search')) bookEl.hidden = true })
addEventListener('resize', () => { if (!bookEl.hidden) { const r = bookEl.getBoundingClientRect(); placeBookWin({ x: r.left, y: r.top, w: r.width, h: r.height }) } })

// ---------- 경로(전도로·신경 주행·혈류) ----------
const flowGroup = new THREE.Group()
scene.add(flowGroup)
let flow = null
function buildPathways() {
  const ps = R.pathways ?? []
  $('#pathList').innerHTML = ps.length
    ? ps.map((p) => `<button class="path-row" data-path="${esc(p.id)}"><b>${esc(p.ko || p.en)}</b><span>${esc(p.en || '')}</span></button>`).join('')
    : '<p class="muted">이 영역에는 아직 경로가 없어요.</p>'
  $('#pathDetail').innerHTML = ''
}
function anchorOf(step) {
  if (step.point) return V(step.point)
  const ms = meshesFor(step.s) ?? []
  if (!ms.length) return null
  return centroidOf(ms, step.at)
}
function centroidOf(ms, at) {
  const box = new THREE.Box3()
  for (const m of ms) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox) }
  const c = box.getCenter(new THREE.Vector3())
  if (at) { // 'top' | 'bottom' | [fx,fy,fz] 상자 안 비율 위치
    const s = box.getSize(new THREE.Vector3())
    const f = at === 'top' ? [0.5, 0.95, 0.5] : at === 'bottom' ? [0.5, 0.05, 0.5] : at
    return new THREE.Vector3(box.min.x + s.x * f[0], box.min.y + s.y * f[1], box.min.z + s.z * f[2])
  }
  return c
}
function showPath(id) {
  clearFlow()
  const p = R.pathways.find((x) => x.id === id)
  if (!p) return
  activePath = p
  applyLabelVisibility()
  document.querySelectorAll('.path-row').forEach((b) => b.classList.toggle('active', b.dataset.path === id))
  const pts = [], stepAt = []
  p.steps.forEach((s, i) => { const a = anchorOf(s); if (a) { pts.push(a); stepAt.push(i) } })
  for (const s of p.steps) if (s.s) ensureVisible(s.s)
  $('#pathDetail').innerHTML = `<h4>${esc(p.ko || p.en)}</h4>
    ${p.figs?.length ? `<div class="figs">${p.figs.map((f) => `<button class="fig-chip" data-fig="${esc(f.src)}|${esc(f.fig)}|${f.page}">${esc(SRC[f.src] ?? f.src)} 그림 ${esc(f.fig)}</button>`).join('')}</div>` : ''}
    <ol class="steps">${p.steps.map((s, i) => {
      const st = R.structures[s.s]
      return `<li data-step="${i}"><button class="linklike" data-select="${esc(s.s ?? '')}">${esc(st?.ko || st?.en || s.label || s.s || '')}</button>${s.note ? ` — ${esc(s.note)}` : ''}${!s.point && !p.points && !(meshesFor(s.s) ?? []).length ? ' <small class="warn">3D 없음</small>' : ''}</li>`
    }).join('')}</ol>
    ${p.schematic !== false ? '<p class="hint">경로선은 구조물 중심을 이은 도식이에요. 실제 섬유 위치와는 다를 수 있어요.</p>' : ''}`
  if (p.points) { // 미리 계산한 정밀 경로
    pts.length = 0; pts.push(...p.points.map(V))
    stepAt.length = 0; p.steps.forEach((_, i) => stepAt.push(i))
  }
  if (pts.length < 2) { $('#pathDetail').insertAdjacentHTML('beforeend', '<p class="hint warn-text">이 경로는 3D 위치를 잡을 수 있는 구조가 2곳 미만이라 경로선 없이 단계 설명만 보여줘요. 교재 그림으로 확인하세요.</p>'); return }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(60, pts.length * 30), 0.006, 8),
    new THREE.MeshBasicMaterial({ color: p.color ?? '#fff3b0', transparent: true, opacity: 0.55, depthTest: false }))
  tube.renderOrder = 10
  flowGroup.add(tube)
  const dots = Array.from({ length: 6 }, (_, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.014 - i * 0.0015, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 1 - i * 0.13 }))
    m.renderOrder = 11; flowGroup.add(m); return m
  })
  const len = curve.getLength()
  // 단계 위치(곡선 매개변수) — 점 사이 거리 비율로 근사
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]))
  const marks = p.points ? p.steps.map((s) => s.u ?? 0) : cum.map((d) => d / (cum.at(-1) || 1))
  flow = { curve, dots, len, t: 0, marks, stepAt, synapseU: p.synapseU, color: new THREE.Color(p.color ?? '#ffffff') }
  flyTo([tube])
}
function clearFlow() {
  for (const c of [...flowGroup.children]) { c.geometry.dispose(); c.material.dispose(); flowGroup.remove(c) }
  flow = null
  activePath = null
  applyLabelVisibility()
}
function tickFlow(dt) {
  if (!flow) return
  flow.t = (flow.t + dt * (0.5 / Math.max(flow.len, 0.5))) % 1.08
  flow.dots.forEach((m, i) => {
    const u = flow.t - i * 0.012
    m.visible = u >= 0 && u <= 1
    if (m.visible) m.position.copy(flow.curve.getPointAt(Math.min(1, u)))
    if (flow.synapseU !== undefined) m.material.color.set(u < flow.synapseU ? '#e8f1ff' : flow.color)
  })
  let k = 0
  while (k + 1 < flow.marks.length && flow.t >= flow.marks[k + 1]) k++
  const active = flow.stepAt[k]
  document.querySelectorAll('#pathDetail .steps li').forEach((li) => li.classList.toggle('on', +li.dataset.step === active))
}

// ---------- 단면 ----------
function buildSections() {
  const has = (R.sections ?? []).length
  document.querySelector('[data-mode="section"]').hidden = !has && !R.allowClip
  $('#sectionList').innerHTML = (R.sections ?? []).map((s, i) => `<button class="fig-row" data-section="${i}"><b>p.${s.page}</b><span>${esc(s.title)}</span></button>`).join('')
}
function setClip(axis, value, flip = false) {
  const n = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[axis]
  clipPlane.normal.set(...n).multiplyScalar(flip ? 1 : -1)
  clipPlane.constant = flip ? -value : value
  clipOn = true
}
function clearClip() { clipPlane.normal.set(0, -1, 0); clipPlane.constant = 1e6; clipOn = false }
function regionBox() {
  const b = new THREE.Box3()
  for (const m of meshes) if (m.visible && !m.userData.overlay) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox) }
  return b
}

// ---------- 퀴즈 ----------
let quiz = null
function resetQuiz() { quiz = null; $('#quizBox').innerHTML = `<p class="muted">${(R.quiz ?? []).length}문항 · 교재 그림 기준</p><button class="primary" id="quizStart">시작</button>` }
function startQuiz() {
  const bank = [...(R.quiz ?? [])].sort(() => Math.random() - 0.5)
  quiz = { queue: bank, retry: new Set(), done: 0, right: 0, cur: null, answered: false }
  nextQ()
}
function nextQ() {
  if (!quiz.queue.length) {
    $('#quizBox').innerHTML = `<p class="q">끝! ${quiz.right} / ${quiz.done}</p><p class="muted">틀린 문제는 한 번 더 나왔어요.</p><button class="primary" id="quizStart">다시 하기</button>`
    return
  }
  const q = quiz.cur = quiz.queue.shift()
  quiz.answered = false
  const opts = q.kind === 'ox'
    ? '<button class="opt" data-a="true">O</button><button class="opt" data-a="false">X</button>'
    : q.options.map((o, i) => `<button class="opt" data-a="${i}">${esc(o)}</button>`).join('')
  $('#quizBox').innerHTML = `<p class="muted">${quiz.done + 1}번째 · 맞힘 ${quiz.right} · 남은 ${quiz.queue.length}</p>
    <p class="q">${esc(q.q)}</p><div class="opts">${opts}</div><div id="feedback"></div>`
  if (q.focus && bySid.has(q.focus)) select(q.focus, { fly: true })
}
function answer(a) {
  if (!quiz || quiz.answered) return
  const q = quiz.cur
  const ok = q.kind === 'ox' ? String(q.answer) === String(a) : +a === q.answer
  quiz.answered = true; quiz.done++
  if (ok) quiz.right++
  else if (!quiz.retry.has(q)) { quiz.retry.add(q); quiz.queue.splice(Math.min(3, quiz.queue.length), 0, q) }
  document.querySelectorAll('.opt').forEach((b) => {
    const isAns = q.kind === 'ox' ? b.dataset.a === String(q.answer) : +b.dataset.a === q.answer
    b.classList.toggle('right', isAns); b.classList.toggle('wrong', !isAns && b.dataset.a === String(a)); b.disabled = true
  })
  const ref = q.ref ? `<button class="fig-chip" data-fig="${esc(q.refSrc ?? R.defaultSrc)}|${esc(q.ref)}|${q.refPage ?? ''}">교재 그림 ${esc(q.ref)}</button>` : ''
  $('#feedback').innerHTML = `<p class="${ok ? 'ok' : 'no'}">${ok ? '정답' : '오답'}</p><p>${esc(q.why ?? '')}</p>${ref}<button class="primary" id="nextQ">다음</button>`
}

// ---------- 검색 (모든 영역) ----------
const norm = (x) => String(x ?? '').toLowerCase().replace(/[\s·()\-–,→←:'’]/g, '')
function searchAll(q) {
  const k = norm(q)
  if (!k) return []
  const words = q.split(/\s+/).map(norm).filter(Boolean)
  const out = []
  for (const e of INDEX.search) {
    let s = e.t.startsWith(k) ? 0 : e.t.includes(k) ? 1 : e.e.startsWith(k) ? 1 : e.h.includes(k) ? 2 : -1
    if (s < 0 && words.length > 1 && words.every((w) => e.h.includes(w))) s = 3
    if (s < 0) continue
    if (R && e.r === R.id) s -= 0.5
    if (!e.m) s += 0.3
    out.push([s, e.ko.length, e])
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 12).map((x) => x[2])
}
const searchInput = $('#search'), resultsBox = $('#results')
let results = [], activeRes = 0
function renderResults() {
  resultsBox.hidden = !searchInput.value
  const rname = (id) => INDEX.regions.find((r) => r.id === id)?.ko ?? id
  resultsBox.innerHTML = results.length
    ? results.map((r, i) => `<li data-i="${i}" class="${i === activeRes ? 'on' : ''}"><b>${esc(r.ko)}</b><span>${esc(r.en)} · ${esc(rname(r.r))}${r.m ? '' : ' · 3D 없음'}</span></li>`).join('')
    : '<li class="empty">찾는 구조가 없어요</li>'
}
async function choose(i) {
  const r = results[i]
  if (!r) return
  searchInput.value = r.ko; results = []; resultsBox.hidden = true; searchInput.blur()
  if (!R || R.id !== r.r) await loadRegion(r.r, { select: r.id })
  else focusOn(r.id)
}
searchInput.addEventListener('input', () => { results = searchAll(searchInput.value); activeRes = 0; renderResults() })
searchInput.addEventListener('focus', () => { if (searchInput.value) { searchInput.select(); results = searchAll(searchInput.value); renderResults() } })
searchInput.addEventListener('blur', () => setTimeout(() => { resultsBox.hidden = true }, 150))
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { activeRes = Math.min(activeRes + 1, results.length - 1); renderResults(); e.preventDefault() }
  else if (e.key === 'ArrowUp') { activeRes = Math.max(activeRes - 1, 0); renderResults(); e.preventDefault() }
  else if (e.key === 'Enter') choose(activeRes)
  else if (e.key === 'Escape') { searchInput.value = ''; resultsBox.hidden = true; searchInput.blur() }
})
resultsBox.addEventListener('pointerdown', (e) => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); choose(+li.dataset.i) } })
window.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== searchInput && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); searchInput.focus() }
})

function focusOn(sid) {
  if (!R.structures[sid]) return
  ensureVisible(sid)
  select(sid, { fly: true })
  if (!bySid.has(sid)) {
    const f = R.structures[sid].figs?.[0]
    if (f) toast('3D 모델이 없는 구조예요. 교재 그림 버튼으로 확인하세요.')
  }
}

// ---------- 카메라 ----------
let camTween = null
function flyTo(objs, dir) {
  const box = new THREE.Box3()
  for (const o of objs) box.expandByObject(o)
  if (box.isEmpty()) return
  const c = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3()).length()
  const d = dir ? V(dir).normalize() : camera.position.clone().sub(controls.target).normalize()
  const dist = THREE.MathUtils.clamp(size * 1.6 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / 2.2, 0.35, 30)
  camTween = { t: 0, fromP: camera.position.clone(), fromT: controls.target.clone(), toP: c.clone().add(d.multiplyScalar(dist)), toT: c }
}
function fitAll(view) {
  if (view) { camTween = { t: 0, fromP: camera.position.clone(), fromT: controls.target.clone(), toP: V(view.pos), toT: V(view.target) }; return }
  const fc = R.fitCats ? meshes.filter((m) => R.fitCats.includes(m.userData.cat)) : []
  flyTo((fc.length ? fc : meshes.filter((m) => !m.userData.overlay && m.userData.cat !== 'context')), [0.35, 0.15, 1])
}
const VIEWDIR = { front: [0, 0, 1], back: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0], top: [0, 1, 0.001], bottom: [0, -1, 0.001] }

// ---------- 입력 ----------
const ray = new THREE.Raycaster()
const ndc = new THREE.Vector2()
function visibleChain(o) { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true }
function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect()
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
  ray.setFromCamera(ndc, camera)
  const hits = ray.intersectObjects(pickables, false).filter((h) => {
    const o = h.object.userData.proxyOf ?? h.object
    if (!visibleChain(o)) return false
    if (clipOn && clipPlane.distanceToPoint(h.point) < 0) return false
    if (figureFocus && o.material.opacity < 0.2) return false
    return true
  })
  if (!hits.length) return null
  const o = hits[0].object.userData.proxyOf ?? hits[0].object
  return o.userData.sid ?? null
}
let down = null
renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY] })
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return
  select(pick(e))
})
const tip = $('#tip')
let lastMove = 0
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || performance.now() - lastMove < 60) return
  lastMove = performance.now()
  const sid = pick(e)
  const st = sid && R.structures[sid]
  tip.hidden = !st
  if (st) { tip.textContent = st.ko || st.en; tip.style.left = `${e.clientX + 14}px`; tip.style.top = `${e.clientY + 12}px` }
  renderer.domElement.style.cursor = st ? 'pointer' : 'grab'
})
renderer.domElement.addEventListener('pointerleave', () => { tip.hidden = true })

document.addEventListener('click', (e) => {
  const t = e.target.closest('button')
  if (!t) return
  const d = t.dataset
  if (d.region) { history.replaceState(null, '', `#${d.region}`); loadRegion(d.region) }
  if (d.select !== undefined && d.select) focusOn(d.select)
  if (d.goto) { const [rg, sid] = d.goto.split('|'); history.replaceState(null, '', `#${rg}`); loadRegion(rg, { select: sid }) }
  if (t.hasAttribute('data-close')) select(null)
  if (d.view) flyTo(meshes.filter((m) => m.visible && !m.userData.overlay), VIEWDIR[d.view])
  if (d.fit !== undefined) fitAll(R.views?.default)
  if (d.mode) setMode(d.mode)
  if (d.figrow) { const [s, f] = d.figrow.split('|'); showFigure(s, f) }
  if (d.fig) { const [s, f, p] = d.fig.split('|'); if (p) openTextbook(s, f, p); else { const fr = R.figures.find((x) => x.src === s && x.fig === f); if (fr) openTextbook(s, f, fr.page) } }
  if (t.hasAttribute('data-figclear')) clearFigure()
  if (d.path) showPath(d.path)
  if (d.section !== undefined) showSection(+d.section)
  if (d.a !== undefined && t.classList.contains('opt')) answer(d.a)
  if (t.id === 'quizStart') startQuiz()
  if (t.id === 'nextQ') nextQ()
  if (t.id === 'aboutBtn') $('#about').showModal()
  if (t.id === 'aboutClose') $('#about').close()
  if (t.id === 'panelToggle') document.body.classList.toggle('panel-collapsed')
  if (t.id === 'panelsToggle') { const h = document.body.classList.toggle('panels-hidden'); t.classList.toggle('active', h); resize() }
  if (t.id === 'clipClear') { clearClip(); $('#clipRange').value = 1 }
})
$('#clipAxis').addEventListener('change', updateClipFromUI)
$('#clipRange').addEventListener('input', updateClipFromUI)
function updateClipFromUI() {
  const axis = $('#clipAxis').value
  const v = +$('#clipRange').value
  const b = regionBox()
  if (b.isEmpty()) return
  const k = { x: 'x', y: 'y', z: 'z' }[axis]
  const val = b.min[k] + (b.max[k] - b.min[k]) * v
  if (v >= 0.999) clearClip(); else setClip(k, val, axis === 'x')
}
function showSection(i) {
  const s = R.sections[i]
  document.querySelectorAll('[data-section]').forEach((b) => b.classList.toggle('active', +b.dataset.section === i))
  if (s.clip) {
    setClip(s.clip.axis, s.clip.value, s.clip.flip)
    const ids = new Set(Object.values(s.map ?? {}))
    const ms = [...ids].flatMap((x) => bySid.get(x) ?? [])
    if (ms.length) flyTo(ms, s.clip.axis === 'y' ? [0.001, 1, 0.35] : s.clip.axis === 'z' ? [0, 0.15, 1] : [1, 0.1, 0.001])
  } else clearClip()
  $('#sectionDetail').innerHTML = `<h4>${esc(s.title)}</h4>
    <img class="plate" src="public/textbook/${s.src === 'NEURO' ? 'neuro' : 'vmra'}/${s.img}" alt="${esc(s.title)}">
    <div class="fig-items">${(s.labels ?? []).map((l) => {
      const sid = s.map?.[l]
      return sid ? `<button class="chip-btn" data-select="${esc(sid)}">${esc(R.structures[sid]?.ko ?? l)}</button>` : `<span class="chip-plain">${esc(l)}</span>`
    }).join('')}</div>
    ${s.clip ? '<p class="hint">3D는 이 높이에서 잘라 보여줘요. 잘린 면은 단순한 모델이라 염색 사진과 모양이 다를 수 있어요.</p>' : ''}`
}

function setMode(m) {
  mode = m
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === m))
  document.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== m })
  if (m !== 'path') clearFlow()
  if (m !== 'figure' && figureFocus) clearFigure()
  if (m !== 'section' && clipOn) clearClip()
}

let toastTimer
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true }, 3200)
}
function setLoading(msg) { const el = $('#loading'); el.hidden = !msg; if (msg) el.textContent = msg }

// ---------- 루프 ----------
function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight
  renderer.setSize(w, h); labelRenderer.setSize(w, h)
  camera.aspect = w / h; camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
const clock = new THREE.Clock()
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05)
  if (camTween) {
    camTween.t = Math.min(1, camTween.t + dt * 1.6)
    const k = 1 - Math.pow(1 - camTween.t, 3)
    camera.position.lerpVectors(camTween.fromP, camTween.toP, k)
    controls.target.lerpVectors(camTween.fromT, camTween.toT, k)
    if (camTween.t >= 1) camTween = null
  }
  controls.update()
  const dir = camera.position.clone().sub(controls.target).normalize()
  key.position.copy(controls.target).add(new THREE.Vector3(dir.x + 1.2, 2.5, dir.z + 1.5).multiplyScalar(4))
  rim.position.copy(controls.target).add(dir.clone().multiplyScalar(-6)).add(new THREE.Vector3(0, 2, 0))
  camLight.position.copy(camera.position)
  tickFlow(dt)
  renderer.render(scene, camera)
  labelRenderer.render(scene, camera)
  requestAnimationFrame(frame)
}

// ---------- 시작 ----------
async function start() {
  if (window.Capacitor?.isNativePlatform?.()) document.body.classList.add('native')
  resize()
  camera.position.set(2, 2, 6)
  INDEX = await fetchJson('public/data/index.json')
  try { FIGPOS = await fetchJson('public/data/figpos.json') } catch {}
  INDEX.search = INDEX.search.map((e) => ({ ...e, t: norm(e.ko), e: norm(e.en), h: norm([e.ko, e.en, ...(e.a ?? [])].join(' ')) }))
  $('#regions').innerHTML = INDEX.regions.map((r) => `<button data-region="${r.id}" title="${esc(r.en)}">${esc(r.ko)}</button>`).join('')
  $('#aboutBody').innerHTML = INDEX.about ?? ''
  frame()
  let first = INDEX.regions[0].id
  try { const s = localStorage.getItem('atlas.region'); if (s && INDEX.regions.some((r) => r.id === s)) first = s } catch {}
  const hash = decodeURIComponent(location.hash.slice(1))
  if (INDEX.regions.some((r) => r.id === hash)) first = hash
  await loadRegion(first)
}
window.addEventListener('hashchange', () => { const h = decodeURIComponent(location.hash.slice(1)); if (INDEX?.regions.some((r) => r.id === h) && R?.id !== h) loadRegion(h) })
start().catch((e) => { console.error(e); setLoading(`불러오기 실패: ${e.message}`) })
window.__atlas = { meshesFor, setMode, showSection, startQuiz, get camTween() { return camTween }, get flow() { return flow }, get R() { return R }, scene, camera, controls, select, focusOn, loadRegion, showFigure, showPath, searchAll, bySid }

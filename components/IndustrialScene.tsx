'use client'

import { Component, ErrorInfo, MutableRefObject, ReactNode, Suspense, memo, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { BakeShadows, Cloud, Clouds, ContactShadows, Html, Preload, useGLTF, useProgress, useTexture } from '@react-three/drei'
import { Bloom, EffectComposer, SMAA, SSAO, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'

type ProgressRef = MutableRefObject<number>

function describeSceneError(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const event = error as { type?: string; target?: { currentSrc?: string; src?: string } }
    const source = event.target?.currentSrc || event.target?.src
    if (source) return `${event.type ?? 'ОШИБКА РЕСУРСА'} · ${source}`
    try { return JSON.stringify(error, Object.getOwnPropertyNames(error)) }
    catch { return String(error) }
  }
  return String(error)
}

class SceneErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }

  static getDerivedStateFromError(error: unknown) {
    return { error: describeSceneError(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('AXIOM scene failed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="spatial-error"><strong>3D-СЦЕНА НЕДОСТУПНА</strong><span>{this.state.error}</span></div>
    )
  }
}

function SceneLoading() {
  const { active } = useProgress()
  if (!active) return null
  return <div className="spatial-loading" role="status"><i />ЗАГРУЖАЕМ МОДЕЛЬ ОБЪЕКТА</div>
}
const REFINERY_PARTS_URL = '/models/industrial/refinery-parts.glb'
const LIME = '#d9ed86'
const ICE = '#9ecdd1'
const AO_COLOR = new THREE.Color('#0b1715')

function makeSurfaceMap(seed: number, contrast: number, repeat: number) {
  const size = 128
  const data = new Uint8Array(size * size)
  let state = seed >>> 0
  for (let index = 0; index < data.length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0
    const grain = (state >>> 24) / 255
    const x = index % size
    const y = Math.floor(index / size)
    const brushed = Math.sin((x + seed) * .53) * .08 + Math.sin((y + seed) * .11) * .035
    data[index] = Math.round(THREE.MathUtils.clamp(.52 + (grain - .5) * contrast + brushed, 0, 1) * 255)
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeat, repeat)
  texture.needsUpdate = true
  return texture
}

function makeWaterSurfaceMaps() {
  const size = 256
  const data = new Uint8Array(size * size * 4)
  const heights = new Uint8Array(size * size)
  const heightAt = (x: number, y: number) => (
    Math.sin((x * 5 + y * 2) * Math.PI * 2 / size + Math.sin((x * 2 - y) * Math.PI * 2 / size) * 1.7) * .48
    + Math.sin((x * 2 - y * 4) * Math.PI * 2 / size + Math.sin((x + y * 3) * Math.PI * 2 / size) * 1.2) * .31
    + Math.sin((x * 9 + y * 7) * Math.PI * 2 / size) * .09
  )

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = heightAt(x + 1, y) - heightAt(x - 1, y)
      const dy = heightAt(x, y + 1) - heightAt(x, y - 1)
      const nx = -dx * 1.15
      const ny = -dy * 1.15
      const inverseLength = 1 / Math.hypot(nx, ny, 1)
      const index = (y * size + x) * 4
      heights[y * size + x] = THREE.MathUtils.clamp((heightAt(x, y) + .88) / 1.76, 0, 1) * 255
      data[index] = (nx * inverseLength * .5 + .5) * 255
      data[index + 1] = (ny * inverseLength * .5 + .5) * 255
      data[index + 2] = (inverseLength * .5 + .5) * 255
      data[index + 3] = 255
    }
  }

  const normal = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping
  normal.repeat.set(5.5, 5.5)
  normal.generateMipmaps = true
  normal.minFilter = THREE.LinearMipmapLinearFilter
  normal.magFilter = THREE.LinearFilter
  normal.anisotropy = 8
  normal.colorSpace = THREE.NoColorSpace
  normal.needsUpdate = true

  const height = new THREE.DataTexture(heights, size, size, THREE.RedFormat)
  height.wrapS = height.wrapT = THREE.RepeatWrapping
  height.repeat.set(5.5, 5.5)
  height.colorSpace = THREE.NoColorSpace
  height.needsUpdate = true
  return { normal, height }
}
const CONCRETE_MAP = makeSurfaceMap(731, .7, 13)

function makeBrushedSteelMaps() {
  const size = 256
  const normalData = new Uint8Array(size * size * 4)
  const roughnessData = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4
      const angle = x / size * Math.PI * 2
      const grain = Math.sin(angle * 53) * .035 + Math.sin(angle * 97 + Math.sin(y / size * Math.PI * 2) * .12) * .02
      normalData.set([128 + grain * 255, 128, 255, 255], index)
      const roughness = Math.round(185 + Math.sin(angle * 29) * 9 + grain * 70)
      roughnessData.set([roughness, roughness, roughness, 255], index)
    }
  }
  const normalMap = new THREE.DataTexture(normalData, size, size, THREE.RGBAFormat)
  const roughnessMap = new THREE.DataTexture(roughnessData, size, size, THREE.RGBAFormat)
  for (const map of [normalMap, roughnessMap]) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.repeat.set(3, 2)
    map.generateMipmaps = true
    map.minFilter = THREE.LinearMipmapLinearFilter
    map.magFilter = THREE.LinearFilter
    map.anisotropy = 8
    map.needsUpdate = true
  }
  return { normalMap, roughnessMap }
}

function makeTerrainMap() {
  const size = 192
  const data = new Uint8Array(size * size * 4)
  let state = 0xa511e9b3
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      state = (state * 1664525 + 1013904223) >>> 0
      const grain = ((state >>> 24) / 255 - .5) * 24
      const broad = Math.sin(x * .085) * 13 + Math.cos(y * .072) * 11 + Math.sin((x + y) * .036) * 9
      const dry = Math.max(0, Math.sin(x * .043 - y * .031)) * 13
      const gravel = (state & 255) > 238 ? 17 : 0
      const index = (y * size + x) * 4
      data[index] = Math.round(101 + broad * .55 + dry + grain + gravel)
      data[index + 1] = Math.round(96 + broad * .5 - dry * .1 + grain + gravel)
      data[index + 2] = Math.round(76 + broad * .36 - dry * .28 + grain + gravel)
      data[index + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(2.4, 2.4)
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

const TERRAIN_MAP = makeTerrainMap()

function prepareTexture(texture: THREE.Texture, repeat: number, color = false) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeat, repeat)
  texture.anisotropy = 8
  if (color) texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function usePaintedMetalMaps() {
  const maps = useTexture({
    normalMap: '/textures/ambientcg/painted-metal/PaintedMetal006_1K-JPG_NormalGL.jpg',
    roughnessMap: '/textures/ambientcg/painted-metal/PaintedMetal006_1K-JPG_Roughness.jpg',
    metalnessMap: '/textures/ambientcg/painted-metal/PaintedMetal006_1K-JPG_Metalness.jpg',
  })
  useMemo(() => Object.values(maps).forEach((texture) => prepareTexture(texture, 4)), [maps])
  return maps
}

function useConcreteMaps() {
  const maps = useTexture({
    map: '/textures/ambientcg/concrete/Concrete045_1K-JPG_Color.jpg',
    normalMap: '/textures/ambientcg/concrete/Concrete045_1K-JPG_NormalGL.jpg',
    roughnessMap: '/textures/ambientcg/concrete/Concrete045_1K-JPG_Roughness.jpg',
  })
  useMemo(() => Object.entries(maps).forEach(([key, texture]) => prepareTexture(texture, 6, key === 'map')), [maps])
  return maps
}

function useAsphaltMaps() {
  const maps = useTexture({
    map: '/textures/ambientcg/asphalt/Asphalt030_1K-JPG_Color.jpg',
    normalMap: '/textures/ambientcg/asphalt/Asphalt030_1K-JPG_NormalGL.jpg',
    roughnessMap: '/textures/ambientcg/asphalt/Asphalt030_1K-JPG_Roughness.jpg',
  })
  useMemo(() => Object.entries(maps).forEach(([key, texture]) => prepareTexture(texture, 10, key === 'map')), [maps])
  return maps
}

function useMountainMaps() {
  const maps = useTexture({
    map: '/textures/polyhaven/rock-face-03/diffuse.jpg',
    normalMap: '/textures/polyhaven/rock-face-03/normal.jpg',
    roughnessMap: '/textures/polyhaven/rock-face-03/roughness.jpg',
    displacementMap: '/textures/polyhaven/rock-face-03/displacement.jpg',
  })
  useMemo(() => Object.entries(maps).forEach(([key, texture]) => prepareTexture(texture, 1, key === 'map')), [maps])
  return maps
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const smooth = (value: number, from: number, to: number) => {
  const x = clamp((value - from) / Math.max(to - from, 0.0001))
  return x * x * (3 - 2 * x)
}
const sceneWindow = (progress: number, enter: number, full: number, leave: number, gone: number) => (
  smooth(progress, enter, full) * (1 - smooth(progress, leave, gone))
)

const flowVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const flowFragment = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    float carrier = pow(max(0.0, sin((vUv.x - uTime * .18) * 52.0)), 26.0);
    float trace = pow(max(0.0, sin((vUv.x - uTime * .1) * 10.0)), 54.0);
    float edge = smoothstep(.5, .05, abs(vUv.y - .5));
    float pulse = .5 + .5 * sin(uTime * 1.4 - vUv.x * 12.0);
    float alpha = (carrier * .78 + trace * .58 + edge * .12 + pulse * .04) * uOpacity;
    vec3 color = mix(uColor * .56, vec3(.87, 1.0, .92), carrier);
    gl_FragColor = vec4(color, alpha);
  }
`

function normalizeModel(object: THREE.Object3D, targetSize = 11) {
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const scale = targetSize / Math.max(size.x, size.y, size.z)
  object.scale.setScalar(scale)
  object.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
}

function WorldCallout({
  progressRef,
  position,
  window,
  label,
  value,
  meta,
  align = 'left',
  tone = 'lime',
}: {
  progressRef: ProgressRef
  position: [number, number, number]
  window: [number, number, number, number]
  label: string
  value: string
  meta: string
  align?: 'left' | 'right'
  tone?: 'lime' | 'blue'
}) {
  const element = useRef<HTMLDivElement>(null)
  useFrame(() => {
    if (!element.current) return
    const opacity = sceneWindow(progressRef.current, ...window)
    element.current.style.opacity = opacity.toFixed(3)
    element.current.style.transform = `translate3d(0,${(1 - opacity) * 9}px,0) scale(${0.96 + opacity * 0.04})`
  })
  return (
    <Html position={position} center distanceFactor={7.5} zIndexRange={[40, 5]}>
      <div ref={element} className={`world-callout world-callout--${align} world-callout--${tone}`}>
        <i /><span /><div><small>{label}</small><strong>{value}</strong><em>{meta}</em></div>
      </div>
    </Html>
  )
}

function sampleValleyElevation(x: number, z: number) {
  const padDistance = Math.max(Math.abs(x) / 12.8, Math.abs(z) / 8.9)
  const naturalTerrain = smooth(padDistance, .8, 1.45)
  const basinDistance = Math.sqrt((x / 36) ** 2 + (z / 25) ** 2)
  const edgeRise = smooth(basinDistance, .43, 1) ** 1.55 * .28
  const broadUndulation =
    Math.sin(x * .19 + z * .11) * .12 +
    Math.cos(x * .09 - z * .17) * .1 +
    Math.sin((x + z) * .055) * .08
  const drainageDip = -Math.exp(-((x + 17) ** 2) / 45 - ((z - 1) ** 2) / 120) * .18
  return .015 + naturalTerrain * (edgeRise + broadUndulation + drainageDip)
}

function sampleValleyShoreline(x: number) {
  return -9.6 - Math.sin(x * .19) * 1.55 - Math.cos(x * .085 + .8) * .85
}

function createValleyFloorGeometry() {
  const width = 72
  const frontZ = 25
  const columns = 112
  const rows = 76
  const positions: number[] = []
  const indices: number[] = []
  const uvs: number[] = []
  for (let row = 0; row <= rows; row += 1) {
    const t = row / rows
    for (let column = 0; column <= columns; column += 1) {
      const x = (column / columns - .5) * width
      const backZ = sampleValleyShoreline(x)
      const z = THREE.MathUtils.lerp(backZ, frontZ, t)
      const shoreBlend = smooth(t, 0, .1)
      const elevation = THREE.MathUtils.lerp(-.045, sampleValleyElevation(x, z), shoreBlend)
      positions.push(x, elevation, z)
      uvs.push(column / columns * 8, t * 4.2)
    }
  }
  const stride = columns + 1
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * stride + column
      const b = a + stride
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function createRoadRibbonGeometry(width: number, lateralOffset = 0, elevation = .095) {
  const point = (x: number, z: number) => new THREE.Vector3(x, sampleValleyElevation(x, z) + elevation, z)
  const path = new THREE.CatmullRomCurve3([
    point(-34, 14.3),
    point(-27, 13.4),
    point(-20, 12),
    point(-13.5, 10.15),
    point(-7.6, 8.15),
    point(-2.2, 6.45),
    point(2.3, 6.05),
  ], false, 'catmullrom', .48)
  const segments = 64
  const positions: number[] = []
  const indices: number[] = []
  const uvs: number[] = []
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments
    const center = path.getPoint(t)
    const tangent = path.getTangent(t).normalize()
    const lateral = new THREE.Vector3(-tangent.z, 0, tangent.x)
    center.addScaledVector(lateral, lateralOffset)
    const left = center.clone().addScaledVector(lateral, width * .5)
    const right = center.clone().addScaledVector(lateral, -width * .5)
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z)
    uvs.push(0, t * 8, 1, t * 8)
    if (index < segments) {
      const a = index * 2
      indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function createChamferedPadGeometry(width: number, depth: number, chamfer: number) {
  const shape = new THREE.Shape()
  const halfWidth = width * .5
  const halfDepth = depth * .5
  shape.moveTo(-halfWidth + chamfer, -halfDepth)
  shape.lineTo(halfWidth - chamfer, -halfDepth)
  shape.lineTo(halfWidth, -halfDepth + chamfer)
  shape.lineTo(halfWidth, halfDepth - chamfer)
  shape.lineTo(halfWidth - chamfer, halfDepth)
  shape.lineTo(-halfWidth + chamfer, halfDepth)
  shape.lineTo(-halfWidth, halfDepth - chamfer)
  shape.lineTo(-halfWidth, -halfDepth + chamfer)
  shape.closePath()
  const geometry = new THREE.ShapeGeometry(shape, 8)
  geometry.computeVertexNormals()
  return geometry
}

function ValleyTerrain() {
  const geometry = useMemo(() => createValleyFloorGeometry(), [])
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        map={TERRAIN_MAP}
        color="#b8ae94"
        roughness={.98}
        metalness={0}
        bumpMap={CONCRETE_MAP}
        bumpScale={.13}
      />
    </mesh>
  )
}

function DrainageChannel({
  position,
  length,
  rotation = 0,
}: {
  position: [number, number, number]
  length: number
  rotation?: number
}) {
  const bars = Math.floor(length / .34)
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh receiveShadow>
        <boxGeometry args={[length, .045, .28]} />
        <meshStandardMaterial color="#303633" roughness={.76} metalness={.26} />
      </mesh>
      {Array.from({ length: bars }, (_, index) => (
        <mesh key={index} position={[-length * .5 + .17 + index * .34, .032, 0]}>
          <boxGeometry args={[.032, .035, .31]} />
          <meshStandardMaterial color="#79807b" roughness={.58} metalness={.6} />
        </mesh>
      ))}
    </group>
  )
}

function ValleySurfaceDetails() {
  const rocks = useRef<THREE.InstancedMesh>(null)
  const grass = useRef<THREE.InstancedMesh>(null)
  const rockData = useMemo(() => Array.from({ length: 124 }, (_, index) => {
    const angle = index * 2.399963 + Math.sin(index * 4.17) * .24
    const radius = 13.8 + ((index * 47) % 173) / 173 * 12.5
    const x = Math.cos(angle) * radius * 1.12
    const z = Math.sin(angle) * radius * .76
    const roadZ = x * -.24 + 6.2
    const overlapsRoad = x < 3 && z > 4 && Math.abs(z - roadZ) < 3.2
    const roadAdjustedZ = overlapsRoad ? z - 6.7 : z
    const shoreline = sampleValleyShoreline(x)
    const adjustedZ = Math.max(roadAdjustedZ, shoreline + 4 + (index % 7) * .26)
    const scale = .08 + ((index * 31) % 17) / 17 * .2
    return { x, z: adjustedZ, scale, rotation: angle + index * .7 }
  }), [])
  const grassData = useMemo(() => Array.from({ length: 292 }, (_, index) => {
    const angle = index * 2.399963 + Math.sin(index * 1.73) * .4
    const radius = 13.1 + ((index * 59) % 251) / 251 * 13.5
    const x = Math.cos(angle) * radius * 1.14
    const z = Math.sin(angle) * radius * .75
    const roadZ = x * -.24 + 6.2
    const overlapsRoad = x < 3 && z > 4 && Math.abs(z - roadZ) < 3.25
    const roadAdjustedZ = overlapsRoad ? z - 6.9 : z
    const shoreline = sampleValleyShoreline(x)
    const adjustedZ = Math.max(roadAdjustedZ, shoreline + 3.6 + (index % 9) * .2)
    const scale = .62 + ((index * 19) % 23) / 23 * .92
    return { x, z: adjustedZ, scale, rotation: angle }
  }), [])

  useLayoutEffect(() => {
    const helper = new THREE.Object3D()
    const color = new THREE.Color()
    rockData.forEach((rock, index) => {
      helper.position.set(rock.x, sampleValleyElevation(rock.x, rock.z) + rock.scale * .12, rock.z)
      helper.rotation.set(index * .41, rock.rotation, index * .18)
      helper.scale.set(rock.scale * 1.28, rock.scale * .62, rock.scale)
      helper.updateMatrix()
      rocks.current?.setMatrixAt(index, helper.matrix)
      color.set(index % 4 === 0 ? '#777568' : index % 3 === 0 ? '#565b50' : '#66675b')
      rocks.current?.setColorAt(index, color)
    })
    if (rocks.current) {
      rocks.current.instanceMatrix.needsUpdate = true
      if (rocks.current.instanceColor) rocks.current.instanceColor.needsUpdate = true
    }
    grassData.forEach((tuft, index) => {
      const height = .13 * tuft.scale
      helper.position.set(tuft.x, sampleValleyElevation(tuft.x, tuft.z) + height * .5, tuft.z)
      helper.rotation.set(0, tuft.rotation, (Math.sin(index * 1.9) * .5) * .12)
      helper.scale.set(.72 + (index % 5) * .1, tuft.scale, .72 + (index % 3) * .12)
      helper.updateMatrix()
      grass.current?.setMatrixAt(index, helper.matrix)
      color.set(index % 5 === 0 ? '#b39c62' : index % 3 === 0 ? '#72804d' : '#87905c')
      grass.current?.setColorAt(index, color)
    })
    if (grass.current) {
      grass.current.instanceMatrix.needsUpdate = true
      if (grass.current.instanceColor) grass.current.instanceColor.needsUpdate = true
    }
  }, [grassData, rockData])

  return (
    <>
      <instancedMesh ref={rocks} args={[undefined, undefined, rockData.length]} receiveShadow>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#ffffff" roughness={.96} metalness={0} />
      </instancedMesh>
      <instancedMesh ref={grass} args={[undefined, undefined, grassData.length]}>
        <coneGeometry args={[.026, .13, 5]} />
        <meshStandardMaterial color="#ffffff" roughness={1} metalness={0} />
      </instancedMesh>
    </>
  )
}

function IndustrialValleyGround() {
  const concrete = useConcreteMaps()
  const asphalt = useAsphaltMaps()
  const waterMaps = useMemo(makeWaterSurfaceMaps, [])
  useLayoutEffect(() => () => {
    waterMaps.normal.dispose()
    waterMaps.height.dispose()
  }, [waterMaps])
  useFrame(({ clock }) => {
    waterMaps.normal.offset.set(clock.elapsedTime * .0028, clock.elapsedTime * -.0016)
  })
  const gravelPad = useMemo(() => createChamferedPadGeometry(27, 19, 1.6), [])
  const concretePad = useMemo(() => createChamferedPadGeometry(22.4, 14.2, .7), [])
  const roadShoulder = useMemo(() => createRoadRibbonGeometry(6.8, 0, .07), [])
  const serviceRoad = useMemo(() => createRoadRibbonGeometry(5.1, 0, .095), [])
  const roadEdgeLeft = useMemo(() => createRoadRibbonGeometry(.055, 2.15, .11), [])
  const roadEdgeRight = useMemo(() => createRoadRibbonGeometry(.055, -2.15, .11), [])

  return (
    <group>
      <mesh position={[0, -.065, -24]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[78, 31, 1, 1]} />
        <meshPhysicalMaterial
          color="#388eaa"
          roughness={.16}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={.12}
          ior={1.333}
          envMapIntensity={1.25}
          normalMap={waterMaps.normal}
          clearcoatNormalMap={waterMaps.normal}
          clearcoatNormalScale={new THREE.Vector2(.18, .18)}
          normalScale={new THREE.Vector2(.26, .26)}
        />
      </mesh>
      <ValleyTerrain />
      <mesh geometry={gravelPad} position={[0, .07, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial map={TERRAIN_MAP} color="#736b5d" roughness={1} metalness={0} bumpMap={CONCRETE_MAP} bumpScale={.22} />
      </mesh>
      <mesh geometry={roadShoulder} receiveShadow>
        <meshStandardMaterial map={TERRAIN_MAP} color="#625f56" roughness={1} metalness={0} bumpMap={CONCRETE_MAP} bumpScale={.2} />
      </mesh>
      <mesh geometry={serviceRoad} receiveShadow>
        <meshStandardMaterial {...asphalt} color="#929b9b" roughness={.94} metalness={0} normalScale={new THREE.Vector2(.26, .26)} />
      </mesh>
      {[roadEdgeLeft, roadEdgeRight].map((geometry, index) => (
        <mesh key={index} geometry={geometry}>
          <meshStandardMaterial color="#b8b28d" roughness={.82} metalness={0} />
        </mesh>
      ))}
      <mesh geometry={concretePad} position={[0, .105, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial {...concrete} color="#bac1bf" roughness={.88} metalness={0} normalScale={new THREE.Vector2(.24, .24)} />
      </mesh>
      {[-7.4, -3.7, 0, 3.7, 7.4].map((x) => (
        <mesh key={`joint-x-${x}`} position={[x, .118, 0]} receiveShadow>
          <boxGeometry args={[.026, .015, 13.35]} />
          <meshStandardMaterial color="#5e625d" roughness={1} metalness={0} />
        </mesh>
      ))}
      {[-4.45, 0, 4.45].map((z) => (
        <mesh key={`joint-z-${z}`} position={[0, .118, z]} receiveShadow>
          <boxGeometry args={[21.45, .015, .026]} />
          <meshStandardMaterial color="#5e625d" roughness={1} metalness={0} />
        </mesh>
      ))}
      <DrainageChannel position={[0, .125, 6.85]} length={18.8} />
      <DrainageChannel position={[-10.85, .125, -.25]} length={10.8} rotation={Math.PI / 2} />
      <ValleySurfaceDetails />
    </group>
  )
}

function PremiumIndustrialPlant({ progressRef }: { progressRef: ProgressRef }) {
  const refinery = useGLTF(REFINERY_PARTS_URL)
  const group = useRef<THREE.Group>(null)
  const preparedMaterials = useRef<THREE.MeshStandardMaterial[]>([])
  const painted = usePaintedMetalMaps()
  const concrete = useConcreteMaps()

  const asset = useMemo(() => refinery.scene.clone(true), [refinery.scene])

  useLayoutEffect(() => {
    const prepare = (asset: THREE.Object3D, targetSize: number, process = false) => {
      normalizeModel(asset, targetSize)
      asset.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        object.castShadow = process
        object.receiveShadow = true
        object.frustumCulled = true
        const sources = Array.isArray(object.material) ? object.material : [object.material]
        const materials = sources.map((source, index) => {
          const material = source instanceof THREE.MeshStandardMaterial
            ? source.clone()
            : new THREE.MeshStandardMaterial()
          const label = `${object.name} ${source.name}`.toLowerCase()
          if (label.includes('concrete')) {
            material.color.set('#aeb8b5')
            material.map = concrete.map
            material.normalMap = concrete.normalMap
            material.roughnessMap = concrete.roughnessMap
            material.normalScale.set(.22, .22)
            material.metalness = 0
            material.roughness = .82
          } else if (label.includes('glass')) {
            material.color.set('#83aeb5')
            material.metalness = .08
            material.roughness = .12
            material.transparent = true
            material.opacity = .32
            material.depthWrite = false
          } else if (label.includes('signal') || label.includes('safety')) {
            material.color.set('#b19855')
            material.normalMap = painted.normalMap
            material.roughnessMap = painted.roughnessMap
            material.metalnessMap = painted.metalnessMap
            material.normalScale.set(.14, .14)
            material.metalness = .28
            material.roughness = .48
          } else if (label.includes('dark')) {
            material.color.set('#34423e')
            material.metalness = .34
            material.roughness = .54
          } else {
            const shade = [...object.name].reduce((value, character) => value + character.charCodeAt(0), index)
            if (process) {
              const steelPalette = ['#d1d7d3', '#9ba8a6', '#718783', '#263d41', '#a88f6f', '#8da4a2']
              material.color.set(steelPalette[shade % steelPalette.length])
            } else {
              const structurePalette = ['#8b9995', '#56635f', '#263330', '#6e7b76']
              material.color.set(structurePalette[shade % structurePalette.length])
            }
            material.normalMap = painted.normalMap
            material.roughnessMap = painted.roughnessMap
            material.metalnessMap = painted.metalnessMap
            material.normalScale.set(process ? .1 : .16, process ? .1 : .16)
            material.metalness = process ? .52 + (shade % 3) * .055 : .5
            material.roughness = process ? .43 + (shade % 4) * .035 : .48
          }
            material.envMapIntensity = process ? 1.08 : .82
          material.needsUpdate = true
          preparedMaterials.current.push(material)
          return material
        })
        object.material = Array.isArray(object.material) ? materials : materials[0]
      })
    }
    prepare(asset, 16, true)
    return () => {
      preparedMaterials.current.forEach((material) => material.dispose())
      preparedMaterials.current = []
    }
  }, [asset, concrete.map, concrete.normalMap, concrete.roughnessMap, painted.metalnessMap, painted.normalMap, painted.roughnessMap])

  useFrame(() => {
    const p = progressRef.current
    // Exterior/interior switch happens behind the fully opaque entry cover.
    if (group.current) group.current.visible = p < .555
  })

  const lamps = useMemo(() => [
    [-7.2, .04, -4.7], [-3.6, .04, -4.7], [0, .04, -4.7], [3.6, .04, -4.7], [7.2, .04, -4.7],
  ] as Array<[number, number, number]>, [])

  return (
    <group ref={group} position={[0, -.5, 0]}>
      <IndustrialValleyGround />
      <group rotation={[0, -.38, 0]} position={[0, .08, 0]}>
        <primitive object={asset} />
      </group>
      <FlowPipe progressRef={progressRef} />
      {lamps.map(([x, y, z], index) => (
        <group key={`${x}-${z}`} position={[x, y, z]}>
          <mesh position={[0, .82, 0]}><cylinderGeometry args={[.018, .026, 1.64, 8]} /><meshStandardMaterial color="#454d49" roughness={.45} metalness={.66} /></mesh>
          <mesh position={[0, 1.63, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.035, .035, .025, 16]} /><meshStandardMaterial color="#d9d5bd" emissive="#d9cba8" emissiveIntensity={.72} /></mesh>
          {index % 2 === 0 && <pointLight position={[0, 1.5, 0]} color="#e7efcb" intensity={.1} distance={3.4} />}
        </group>
      ))}
      <WorldCallout progressRef={progressRef} position={[2.7, 3.25, -.9]} window={[.115, .15, .235, .285]} label="ТЕХНОЛОГИЧЕСКИЙ УЗЕЛ / S-04" value="S-04" meta="КОЛОННЫ · ТРУБНЫЕ ЭСТАКАДЫ" />
      <WorldCallout progressRef={progressRef} position={[1.35, 2.55, .15]} window={[.24, .275, .315, .34]} label="СЕПАРАЦИОННАЯ КОЛОННА" value="V-104" meta="КОНТУР ПОДГОТОВКИ ГАЗА" tone="blue" />
    </group>
  )
}

function FlowPipe({ progressRef }: { progressRef: ProgressRef }) {
  const material = useRef<THREE.ShaderMaterial>(null)
  const curve = useMemo(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(2.2, 1.08, 2.3),
    new THREE.Vector3(1.35, 1.0, .55),
    new THREE.Vector3(.72, 1.02, -1.45),
    new THREE.Vector3(.25, 1.06, -3.8),
    new THREE.Vector3(0, 1.08, -7.1),
  ]), [])
  const geometry = useMemo(() => new THREE.TubeGeometry(curve, 160, .075, 12, false), [curve])
  useFrame(({ clock }) => {
    if (!material.current) return
    material.current.uniforms.uTime.value = clock.elapsedTime
    material.current.uniforms.uOpacity.value = sceneWindow(progressRef.current, .515, .555, .67, .72) * .62
  })
  return (
    <mesh geometry={geometry}>
      <shaderMaterial
        ref={material}
        vertexShader={flowVertex}
        fragmentShader={flowFragment}
        uniforms={{ uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(ICE) } }}
        transparent
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </mesh>
  )
}

function createMountainMass({
  width,
  depth,
  columns,
  rows,
  seed,
  peakOffset,
  heightScale,
}: {
  width: number
  depth: number
  columns: number
  rows: number
  seed: number
  peakOffset: number
  heightScale: number
}) {
  const positions: number[] = []
  const indices: number[] = []
  const colors: number[] = []
  const uvs: number[] = []
  const low = new THREE.Color('#3f4941')
  const mid = new THREE.Color('#696b5e')
  const high = new THREE.Color('#7e796b')
  const summit = new THREE.Color('#a09b8e')
  const vertexColor = new THREE.Color()

  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows
    const localZ = (v - .5) * depth
    const depthRidge = Math.pow(Math.exp(-Math.pow((v - .43) / .34, 2)), .72)
    const foothills = Math.pow(Math.sin(v * Math.PI), .72)
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns
      const localX = (u - .5) * width
      const normalizedX = localX / width
      const heroPeak = Math.pow(Math.exp(-Math.pow((normalizedX - peakOffset) * 7.8, 2)), .72) * 1.16
      const shoulder = Math.pow(Math.exp(-Math.pow((normalizedX - peakOffset + .18) * 8.8, 2)), .76) * .68
      const secondary = Math.pow(Math.exp(-Math.pow((normalizedX - peakOffset - .245) * 8.1, 2)), .72) * .54
      const longRidge = .11 + heroPeak + shoulder + secondary
      const broadFold =
        Math.sin(localX * .29 + localZ * .17 + seed) * .07 +
        Math.sin(localX * .73 - localZ * .28 + seed * 2.7) * .045
      const rockDetail =
        Math.abs(Math.sin(localX * 1.37 + localZ * .38 + seed)) * .082 +
        Math.abs(Math.sin(localX * 3.75 - localZ * .91 + seed * 1.3)) * .034 +
        Math.sin(localX * 7.2 + localZ * 1.7 - seed) * .014
      const drainage =
        Math.pow(Math.abs(Math.sin(localX * .43 + localZ * .085 + seed)), 11) *
        -.19 * depthRidge * (.35 + longRidge * .65)
      const edgeFalloff = Math.pow(Math.sin(u * Math.PI), .48)
      const height = Math.max(
        -.18,
        (
          longRidge * depthRidge * edgeFalloff * (1 + broadFold) +
          foothills * .055 +
          rockDetail * depthRidge * edgeFalloff +
          drainage
        ) * heightScale,
      )
      positions.push(localX, height, localZ)
      uvs.push(u * 7, v * 3.2)

      const elevation = THREE.MathUtils.clamp(height / Math.max(heightScale * 1.45, .001), 0, 1)
      const exposedRock = THREE.MathUtils.clamp(
        elevation * .9 + Math.abs(Math.sin(localX * .41 + localZ * .2 + seed)) * .22 - .22,
        0,
        1,
      )
      if (elevation < .2) vertexColor.lerpColors(low, mid, elevation / .2)
      else if (elevation < .68) vertexColor.lerpColors(mid, high, exposedRock * .72)
      else vertexColor.lerpColors(high, summit, THREE.MathUtils.clamp((elevation - .68) / .32, 0, 1))
      const mineralVariation = 1 + Math.sin(localX * 2.7 + localZ * .66 + seed) * .12
      colors.push(vertexColor.r * mineralVariation, vertexColor.g * mineralVariation, vertexColor.b * mineralVariation)
    }
  }
  const stride = columns + 1
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * stride + column
      const b = a + stride
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function MountainHorizon({ progressRef }: { progressRef: ProgressRef }) {
  const group = useRef<THREE.Group>(null)
  const nearMaterial = useRef<THREE.MeshStandardMaterial>(null)
  const nearRockMaterial = useRef<THREE.MeshStandardMaterial>(null)
  const farMaterial = useRef<THREE.MeshStandardMaterial>(null)
  const rock = useMountainMaps()
  const farGeometry = useMemo(() => createMountainMass({
    width: 68,
    depth: 20,
    columns: 176,
    rows: 52,
    seed: 2.1,
    peakOffset: -.08,
    heightScale: 5.05,
  }), [])
  const nearGeometry = useMemo(() => createMountainMass({
    width: 54,
    depth: 18,
    columns: 184,
    rows: 56,
    seed: .65,
    peakOffset: -.13,
    heightScale: 7.15,
  }), [])

  useFrame(() => {
    const opacity = 1 - smooth(progressRef.current, .585, .61)
    if (group.current) group.current.visible = opacity > .004
    if (nearMaterial.current) nearMaterial.current.opacity = opacity
    if (nearRockMaterial.current) nearRockMaterial.current.opacity = opacity * .58
    if (farMaterial.current) farMaterial.current.opacity = opacity * .76
  })

  return (
    <group ref={group} renderOrder={-2}>
      <mesh geometry={farGeometry} position={[-25, -1.05, -49]} rotation={[0, -.025, 0]} receiveShadow>
        <meshStandardMaterial
          ref={farMaterial}
          vertexColors
          normalMap={rock.normalMap}
          normalScale={new THREE.Vector2(.46, .46)}
          roughnessMap={rock.roughnessMap}
          displacementMap={rock.displacementMap}
          displacementScale={.16}
          displacementBias={-.04}
          color="#8e9791"
          emissive="#263b3f"
          emissiveIntensity={.035}
          roughness={.91}
          metalness={0}
          bumpMap={CONCRETE_MAP}
          bumpScale={.1}
          transparent
          opacity={.82}
          side={THREE.DoubleSide}
          depthWrite
        />
      </mesh>
      <mesh geometry={nearGeometry} position={[-24, -1.18, -34]} rotation={[0, -.08, 0]} receiveShadow>
        <meshStandardMaterial
          ref={nearMaterial}
          vertexColors
          normalMap={rock.normalMap}
          normalScale={new THREE.Vector2(.92, .92)}
          roughnessMap={rock.roughnessMap}
          displacementMap={rock.displacementMap}
          displacementScale={.52}
          displacementBias={-.09}
          color="#a7a49b"
          emissive="#111715"
          emissiveIntensity={.006}
          roughness={.98}
          metalness={0}
          bumpMap={CONCRETE_MAP}
          bumpScale={.24}
          envMapIntensity={.18}
          transparent
          opacity={1}
          side={THREE.DoubleSide}
          depthWrite
          flatShading
        />
      </mesh>
      <mesh geometry={nearGeometry} position={[-24, -1.18, -34]} rotation={[0, -.08, 0]} renderOrder={-1}>
        <meshStandardMaterial
          ref={nearRockMaterial}
          map={rock.map}
          normalMap={rock.normalMap}
          normalScale={new THREE.Vector2(.68, .68)}
          roughnessMap={rock.roughnessMap}
          displacementMap={rock.displacementMap}
          displacementScale={.54}
          displacementBias={-.09}
          color="#82786a"
          roughness={1}
          metalness={0}
          envMapIntensity={.1}
          transparent
          opacity={.72}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
    </group>
  )
}

function VolumetricCloudBank({ progressRef }: { progressRef: ProgressRef }) {
  const group = useRef<THREE.Group>(null)

  useFrame(({ clock }) => {
    const opacity = 1 - smooth(progressRef.current, .585, .61)
    if (!group.current) return
    group.current.visible = opacity > .004
    // Slow wind is visible even while the opening camera is stationary.
    group.current.position.x = Math.sin(clock.elapsedTime * .008) * 10
    group.current.position.y = Math.sin(clock.elapsedTime * .06) * .04
  })

  return (
    <group ref={group} renderOrder={-1}>
      <Clouds
        texture="/textures/cg-cloud-puff.png"
        limit={420}
        range={108}
        material={THREE.MeshBasicMaterial}
        frustumCulled={false}
      >
        <Cloud
          seed={1.2}
          position={[-33, 9.8, -36]}
          segments={52}
          bounds={[6.6, 2.5, 2.9]}
          volume={2.65}
          smallestVolume={.35}
          growth={3.7}
          opacity={.62}
          color="#e8edf0"
          fade={44}
          speed={.012}
          concentrate="inside"
        />
        <Cloud
          seed={4.7}
          position={[-9, 11.8, -44]}
          segments={70}
          bounds={[10.8, 3.5, 4.5]}
          volume={3.7}
          smallestVolume={.4}
          growth={4.2}
          opacity={.7}
          color="#f7f4eb"
          fade={50}
          speed={.009}
          concentrate="inside"
        />
        <Cloud
          seed={8.3}
          position={[6, 9.4, -40]}
          segments={54}
          bounds={[7.6, 2.7, 3.4]}
          volume={3.05}
          smallestVolume={.36}
          growth={3.8}
          opacity={.6}
          color="#dbe6eb"
          fade={46}
          speed={.011}
          concentrate="inside"
        />
        <Cloud
          seed={12.4}
          position={[-25, 2.05, -29]}
          segments={58}
          bounds={[11.5, 1.55, 4.8]}
          volume={2.4}
          smallestVolume={.28}
          growth={3.15}
          opacity={.14}
          color="#d4dcda"
          fade={48}
          speed={.006}
          concentrate="inside"
        />
        <Cloud
          seed={16.8}
          position={[8, 2.7, -38]}
          segments={46}
          bounds={[9.2, 1.45, 4.2]}
          volume={2.1}
          smallestVolume={.25}
          growth={3.05}
          opacity={.12}
          color="#bfcfd0"
          fade={52}
          speed={.005}
          concentrate="inside"
        />
      </Clouds>
    </group>
  )
}

function SkyDome({ progressRef }: { progressRef: ProgressRef }) {
  const dome = useRef<THREE.Mesh>(null)
  const material = useRef<THREE.ShaderMaterial>(null)
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uWeather: { value: .9 },
    uStorm: { value: .12 },
    uZenith: { value: new THREE.Color('#001433') },
    uUpper: { value: new THREE.Color('#064c83') },
    uHorizon: { value: new THREE.Color('#68b1b8') },
    uGround: { value: new THREE.Color('#456a68') },
    uWarm: { value: new THREE.Color('#fff0cf') },
    uStormColor: { value: new THREE.Color('#263e4a') },
  }), [])

  useFrame(({ camera, clock }) => {
    if (!material.current) return
    if (dome.current) dome.current.position.copy(camera.position)
    material.current.uniforms.uTime.value = clock.elapsedTime
    const physicalWorld = 1 - smooth(progressRef.current, .58, .88)
    const stormFront = sceneWindow(progressRef.current, .085, .155, .345, .47)
    material.current.uniforms.uWeather.value = .64 + physicalWorld * .28
    material.current.uniforms.uStorm.value = .1 + stormFront * .32
  })

  return (
    <mesh ref={dome} scale={74} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[1, 56, 28]} />
      <shaderMaterial
        ref={material}
        side={THREE.BackSide}
        depthWrite={false}
        toneMapped={false}
        uniforms={uniforms}
        vertexShader={`
          varying vec3 vDirection;
          void main() {
            vDirection = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform float uTime;
          uniform float uWeather;
          uniform float uStorm;
          uniform vec3 uZenith;
          uniform vec3 uUpper;
          uniform vec3 uHorizon;
          uniform vec3 uGround;
          uniform vec3 uWarm;
          uniform vec3 uStormColor;
          varying vec3 vDirection;

          float hash21(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
          }

          float noise21(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
              mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x),
              f.y
            );
          }

          float fbm(vec2 p) {
            float value = 0.0;
            float amplitude = 0.52;
            mat2 rotation = mat2(0.82, -0.57, 0.57, 0.82);
            for (int octave = 0; octave < 4; octave++) {
              value += noise21(p) * amplitude;
              p = rotation * p * 2.03 + 11.7;
              amplitude *= 0.5;
            }
            return value;
          }

          void main() {
            vec3 direction = normalize(vDirection);
            float elevation = direction.y;
            float skyHeight = clamp(elevation, 0.0, 1.0);
            vec3 sky = mix(uHorizon, uUpper, smoothstep(-0.005, 0.19, skyHeight));
            sky = mix(sky, uZenith, smoothstep(0.16, 0.74, skyHeight));
            sky = mix(uGround, sky, smoothstep(-0.2, 0.025, elevation));
            sky = mix(sky, uStormColor, uStorm * .28 * smoothstep(.02, .62, skyHeight));

            float horizonGlow = exp(-abs(elevation) * 12.0);
            sky += uWarm * horizonGlow * 0.11;

            vec3 sunDirection = normalize(vec3(-0.75, 0.13, -0.65));
            float sunAlignment = max(0.0, dot(direction, sunDirection));
            float longitude = atan(direction.z, direction.x) / 6.2831853;
            vec2 cloudUv = vec2(longitude * 9.4, elevation * 5.6);
            float wind = uTime * 0.0048;
            vec2 windOffset = vec2(wind, -wind * .19);
            vec2 warp = vec2(
              fbm(cloudUv * .31 + windOffset + vec2(4.1, 1.7)),
              fbm(cloudUv * .29 - windOffset + vec2(-2.8, 6.4))
            ) - .5;
            vec2 billowUv = cloudUv + warp * 1.35;
            float cloudMacro = fbm(billowUv * .63 + windOffset);
            float cloudBillow = fbm(billowUv * 1.36 - windOffset * 1.7 + vec2(8.3, -3.1));
            float cloudErosion = fbm(billowUv * 3.85 + windOffset * 2.3 + vec2(-5.7, 2.6));
            float cloudShape = cloudMacro * .68 + cloudBillow * .49 - cloudErosion * .18;
            float cloudBand = smoothstep(.018, .095, elevation) * (1.0 - smoothstep(.52, .76, elevation));
            float cumulus = smoothstep(.49, .625, cloudShape) * cloudBand * .22;
            float wisps = smoothstep(.58, .72, cloudBillow * .72 + cloudErosion * .28) * cloudBand * .1;

            vec2 lightOffset = normalize(sunDirection.xz) * .115;
            float lightSample = fbm((billowUv + lightOffset) * 1.36 - windOffset * 1.7 + vec2(8.3, -3.1));
            float selfLight = smoothstep(-.065, .13, cloudBillow - lightSample + elevation * .14);
            float cloudEdge = smoothstep(.45, .565, cloudShape) * (1.0 - smoothstep(.61, .76, cloudShape));
            float silverLining = cloudEdge * pow(sunAlignment, 8.0) * 1.65;

            float stormNoise = cloudMacro * .62 + noise21(cloudUv * .37 + vec2(-1.72 + wind * .38, .76)) * .38;
            float stormDirection = smoothstep(-0.88, 0.22, -direction.x - direction.z * .2);
            float stormBank = smoothstep(.43, .61, stormNoise) * stormDirection * cloudBand * uStorm;
            vec3 cloudShadow = mix(vec3(.34, .43, .48), uStormColor, uStorm * .86);
            vec3 cloudMid = mix(vec3(.69, .76, .77), vec3(.54, .63, .67), uStorm * .42);
            vec3 cloudTop = mix(vec3(.98, .985, .965), vec3(.72, .78, .79), uStorm * .4);
            vec3 cloudColor = mix(cloudShadow, cloudMid, .38 + selfLight * .34);
            cloudColor = mix(cloudColor, cloudTop, smoothstep(.22, .8, selfLight + elevation * .65));
            cloudColor += uWarm * silverLining * .36;
            float cloudCover = clamp((cumulus + wisps) * (.58 + uWeather * .28) + stormBank * .28, 0.0, .2);
            sky = mix(sky, cloudColor, cloudCover);
            sky = mix(sky, uStormColor, stormBank * .32);

            float sunGlow = pow(sunAlignment, 44.0);
            float sunCorona = pow(sunAlignment, 260.0);
            float sunDisc = smoothstep(0.99972, 0.99988, sunAlignment);
            float cloudVeil = 1.0 - cloudCover * (.7 + uStorm * .2);
            float sunStrength = mix(1.0, .48, uStorm);
            vec3 sunRight = normalize(cross(vec3(0.0, 1.0, 0.0), sunDirection));
            vec3 sunUp = normalize(cross(sunDirection, sunRight));
            float rayAngle = atan(dot(direction, sunUp), dot(direction, sunRight));
            float sunRays = pow(max(0.0, cos(rayAngle * 8.0)), 42.0) * pow(sunAlignment, 126.0);
            sky += uWarm * (sunGlow * .12 + sunCorona * .26 + sunDisc * 1.28 + sunRays * .09) * cloudVeil * sunStrength;

            float upperHaze = smoothstep(0.0, 0.24, elevation) * (1.0 - smoothstep(0.24, 0.62, elevation));
            sky += vec3(0.02, 0.055, 0.085) * upperHaze * .72 * (1.0 - uStorm * .42);
            sky = pow(max(sky, vec3(0.0)), vec3(.94));
            gl_FragColor = vec4(sky, 1.0);
          }
        `}
      />
    </mesh>
  )
}

function CinematicAtmosphere({ progressRef }: { progressRef: ProgressRef }) {
  const { scene } = useThree()
  const earlyFog = useMemo(() => new THREE.Color('#9ebfc1'), [])
  const stormFog = useMemo(() => new THREE.Color('#738b8c'), [])
  const deepFog = useMemo(() => new THREE.Color('#1b2729'), [])
  const fogColor = useMemo(() => new THREE.Color(), [])

  useFrame(() => {
    const progress = progressRef.current
    const transition = smooth(progress, .54, .82)
    const storm = sceneWindow(progress, .085, .155, .345, .47)
    const fog = scene.fog
    if (fog instanceof THREE.Fog) {
      fogColor.copy(earlyFog).lerp(stormFog, storm).lerp(deepFog, transition)
      fog.color.copy(fogColor)
      fog.near = THREE.MathUtils.lerp(39 - storm * 4, 10.5, transition)
      fog.far = THREE.MathUtils.lerp(108 - storm * 12, 36, transition)
    }
  })
  return null
}

function PhysicalLighting({ progressRef }: { progressRef: ProgressRef }) {
  const hemisphere = useRef<THREE.HemisphereLight>(null)
  const sun = useRef<THREE.DirectionalLight>(null)
  const fill = useRef<THREE.DirectionalLight>(null)
  const rim = useRef<THREE.DirectionalLight>(null)

  useFrame(() => {
    const late = smooth(progressRef.current, .58, .82)
    if (hemisphere.current) hemisphere.current.intensity = THREE.MathUtils.lerp(.72, .18, late)
    if (sun.current) sun.current.intensity = THREE.MathUtils.lerp(3.35, .58, late)
    if (fill.current) fill.current.intensity = THREE.MathUtils.lerp(.55, .08, late)
    if (rim.current) rim.current.intensity = THREE.MathUtils.lerp(.64, .045, late)
  })

  return (
    <>
      <hemisphereLight ref={hemisphere} args={['#e8f4ff', '#404b4c', .72]} />
      <ambientLight intensity={.1} color="#dcecff" />
      <directionalLight
        ref={sun}
        position={[-13, 16, -9]}
        intensity={3.35}
        color="#fff0d9"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-.00012}
        shadow-normalBias={.035}
        shadow-camera-left={-13}
        shadow-camera-right={13}
        shadow-camera-top={13}
        shadow-camera-bottom={-13}
      />
      <directionalLight ref={fill} position={[12, 7, 11]} intensity={.55} color="#c4e3f5" />
      <directionalLight ref={rim} position={[-9, 5, -5]} intensity={.64} color="#ffe1b2" />
    </>
  )
}

function PhysicalSkyEnvironment() {
  const { gl, scene } = useThree()
  const sky = useLoader(HDRLoader, '/hdri/kloofendal_38d_partly_cloudy_puresky_1k.hdr')
  useLayoutEffect(() => {
    const generator = new THREE.PMREMGenerator(gl)
    const target = generator.fromEquirectangular(sky)
    scene.environment = target.texture
    scene.environmentIntensity = .8
    return () => {
      scene.environment = null
      target.dispose()
      generator.dispose()
    }
  }, [gl, scene, sky])
  return null
}

function TunnelFlowParticles({ progressRef }: { progressRef: ProgressRef }) {
  const material = useRef<THREE.ShaderMaterial>(null)
  const geometry = useMemo(() => {
    const count = 220
    const positions = new Float32Array(count * 3)
    const speeds = new Float32Array(count)
    let state = 0x6d2b79f5
    const random = () => {
      state = (state * 1664525 + 1013904223) >>> 0
      return state / 4294967296
    }
    for (let index = 0; index < count; index += 1) {
      const angle = random() * Math.PI * 2
      const radius = Math.sqrt(random()) * .57
      positions[index * 3] = Math.cos(angle) * radius
      positions[index * 3 + 1] = Math.sin(angle) * radius
      positions[index * 3 + 2] = 1.8 - random() * 23
      speeds[index] = .72 + random() * .58
    }
    const result = new THREE.BufferGeometry()
    result.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    result.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1))
    return result
  }, [])

  useFrame(({ clock }) => {
    if (!material.current) return
    material.current.uniforms.uTime.value = clock.elapsedTime
    material.current.uniforms.uOpacity.value = sceneWindow(progressRef.current, .575, .595, .69, .725)
  })

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        transparent
        depthWrite={false}
        blending={THREE.NormalBlending}
        uniforms={{
          uTime: { value: 0 },
          uOpacity: { value: 0 },
          uColor: { value: new THREE.Color('#b9dfe0') },
        }}
        vertexShader={`
          attribute float aSpeed;
          uniform float uTime;
          varying float vEnergy;
          void main() {
            vec3 transformed = position;
            transformed.z = 1.8 - mod((1.8 - position.z) + uTime * aSpeed * 1.45, 23.0);
            float axial = .5 + .5 * sin(uTime * 2.1 + position.z * 2.8);
            vEnergy = mix(.42, 1.0, axial) * aSpeed;
            vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);
            gl_Position = projectionMatrix * viewPosition;
            gl_PointSize = clamp((1.45 + aSpeed * 1.2) * (52.0 / max(1.0, -viewPosition.z)), 1.1, 4.2);
          }
        `}
        fragmentShader={`
          uniform float uOpacity;
          uniform vec3 uColor;
          varying float vEnergy;
          void main() {
            vec2 centered = gl_PointCoord - .5;
            float radius = length(centered);
            float alpha = smoothstep(.5, .08, radius) * uOpacity * vEnergy * .52;
            gl_FragColor = vec4(uColor, alpha);
          }
        `}
      />
    </points>
  )
}

function InternalFlowRibbon({ progressRef, phase, color }: { progressRef: ProgressRef; phase: number; color: string }) {
  const material = useRef<THREE.ShaderMaterial>(null)
  const curve = useMemo(() => {
    const points = Array.from({ length: 12 }, (_, index) => {
      const z = .2 - index * 2
      const angle = phase + index * .62
      const radius = .34 + Math.sin(index * .91 + phase) * .11
      return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z)
    })
    return new THREE.CatmullRomCurve3(points)
  }, [phase])
  const geometry = useMemo(() => new THREE.TubeGeometry(curve, 132, .012, 6, false), [curve])

  useFrame(({ clock }) => {
    if (!material.current) return
    material.current.uniforms.uTime.value = clock.elapsedTime + phase
    material.current.uniforms.uOpacity.value = sceneWindow(progressRef.current, .575, .595, .69, .725) * .58
  })

  return (
    <mesh geometry={geometry}>
      <shaderMaterial
        ref={material}
        vertexShader={flowVertex}
        fragmentShader={flowFragment}
        uniforms={{ uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(color) } }}
        transparent
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </mesh>
  )
}

function ProcessFlowCutaway({ progressRef }: { progressRef: ProgressRef }) {
  const group = useRef<THREE.Group>(null)
  const tunnelBody = useRef<THREE.Group>(null)
  const tunnelDetails = useRef<THREE.Group>(null)
  const coldLight = useRef<THREE.PointLight>(null)
  const valveDisk = useRef<THREE.Mesh>(null)
  const brushedSteel = useMemo(makeBrushedSteelMaps, [])
  useLayoutEffect(() => () => {
    brushedSteel.normalMap.dispose()
    brushedSteel.roughnessMap.dispose()
  }, [brushedSteel])
  const entranceMaterials = useRef<THREE.MeshStandardMaterial[]>([])
  useLayoutEffect(() => {
    const materials = new Set<THREE.MeshStandardMaterial>()
    group.current?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const list = Array.isArray(object.material) ? object.material : [object.material]
      list.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial && !material.transparent) {
          material.transparent = true
          materials.add(material)
        }
      })
    })
    entranceMaterials.current = [...materials]
  }, [])
  const seamPositions = useMemo(() => [-1.1, -4.2, -7.3, -10.4, -13.5, -16.6, -19.7, -21.35], [])
  const cableAngles = useMemo(() => [-2.34, -.76, 2.52], [])

  useFrame(({ clock }) => {
    const progress = progressRef.current
    const visibility = sceneWindow(progress, .555, .565, .73, .752)
    if (group.current) {
      group.current.visible = visibility > .004
    }
    const inside = visibility > .004
    entranceMaterials.current.forEach((material) => {
      material.opacity = visibility
      material.depthWrite = visibility > .98
    })
    if (tunnelBody.current) tunnelBody.current.visible = inside
    if (tunnelDetails.current) tunnelDetails.current.visible = inside
    if (coldLight.current) coldLight.current.intensity = visibility * (.72 + Math.sin(clock.elapsedTime * 1.2) * .06)
    if (valveDisk.current) valveDisk.current.rotation.y = THREE.MathUtils.lerp(.18, Math.PI / 2 - .035, smooth(progress, .565, .62))
  })

  return (
    <group ref={group} position={[0, 1, -1.3]} visible={false}>
      <group ref={tunnelBody} visible={false}>
        <mesh position={[0, 0, -10.6]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
          <cylinderGeometry args={[2.02, 2.02, 22, 96, 1, true]} />
          <meshStandardMaterial
            {...brushedSteel}
            color="#788789"
            roughness={.52}
            metalness={.78}
            normalScale={new THREE.Vector2(.22, .22)}
            envMapIntensity={.85}
            side={THREE.BackSide}
          />
        </mesh>

        <mesh position={[0, 0, -10.6]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[.68, .68, 22, 56, 1, true]} />
          <meshPhysicalMaterial color="#73aeb1" roughness={.18} metalness={.02} transparent opacity={.11} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>

      <group position={[0, 0, .38]}>
        <mesh><torusGeometry args={[2.08, .16, 20, 108]} /><meshStandardMaterial color="#87918c" metalness={.64} roughness={.32} envMapIntensity={1.16} /></mesh>
        <mesh position={[0, 0, -.08]}><torusGeometry args={[1.82, .055, 12, 96]} /><meshStandardMaterial color="#aab1ac" metalness={.7} roughness={.28} /></mesh>
        {Array.from({ length: 12 }, (_, index) => index * Math.PI / 6).map((angle) => (
          <mesh key={angle} position={[Math.cos(angle) * 2.08, Math.sin(angle) * 2.08, .02]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[.045, .045, .13, 12]} />
            <meshStandardMaterial color="#343a37" metalness={.72} roughness={.29} />
          </mesh>
        ))}
      </group>

      <group ref={tunnelDetails} visible={false}>
        {seamPositions.map((z) => (
          <mesh key={z} position={[0, 0, z]}>
            <torusGeometry args={[1.98, .024, 8, 96]} />
            <meshStandardMaterial color="#78817c" roughness={.34} metalness={.68} envMapIntensity={1.05} />
          </mesh>
        ))}

        {cableAngles.map((angle, index) => (
          <mesh key={angle} position={[Math.cos(angle) * 1.78, Math.sin(angle) * 1.78, -10.5]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[.024, .024, 20.8, 10]} />
            <meshStandardMaterial color={index === 1 ? '#71969a' : '#707973'} roughness={.46} metalness={.5} />
          </mesh>
        ))}

        <group position={[0, 0, -8.7]}>
          <mesh><torusGeometry args={[1.92, .09, 16, 96]} /><meshStandardMaterial color="#959e98" roughness={.32} metalness={.68} /></mesh>
          <mesh ref={valveDisk} rotation={[0, .18, 0]}>
            <circleGeometry args={[1.38, 64]} />
            <meshStandardMaterial color="#63706a" roughness={.39} metalness={.58} side={THREE.DoubleSide} />
          </mesh>
          <mesh><cylinderGeometry args={[.055, .055, 3.38, 16]} /><meshStandardMaterial color="#b7bcb8" roughness={.29} metalness={.72} /></mesh>
        </group>

        {[-5.4, -13.7, -18.2].map((z, index) => (
          <group key={z} position={[index === 1 ? -1.82 : 1.82, index === 1 ? .3 : -.32, z]} rotation={[0, index === 1 ? Math.PI / 2 : -Math.PI / 2, 0]}>
            <mesh castShadow><boxGeometry args={[.36, .52, .11]} /><meshStandardMaterial color="#59635e" roughness={.45} metalness={.46} /></mesh>
            <mesh position={[0, .11, .062]}><boxGeometry args={[.22, .105, .016]} /><meshBasicMaterial color="#a8c6c7" transparent opacity={.6} /></mesh>
            <mesh position={[-.13, -.17, .075]}><sphereGeometry args={[.026, 14, 10]} /><meshStandardMaterial color={index === 2 ? LIME : ICE} emissive={index === 2 ? LIME : ICE} emissiveIntensity={1.1} /></mesh>
          </group>
        ))}

        <TunnelFlowParticles progressRef={progressRef} />
        <InternalFlowRibbon progressRef={progressRef} phase={0} color="#9fd0d2" />
        <InternalFlowRibbon progressRef={progressRef} phase={2.1} color="#7db5bb" />
        <InternalFlowRibbon progressRef={progressRef} phase={4.2} color="#d2e2bb" />
        <pointLight position={[0, .4, -.5]} color="#d6e6e9" intensity={1.5} distance={9} decay={2} />
        <pointLight ref={coldLight} position={[0, .25, -7]} color="#a8d5d7" intensity={0} distance={10} />
        <pointLight position={[0, -.4, -20.6]} color="#d5e0c0" intensity={.38} distance={8.5} />
      </group>
    </group>
  )
}

function PredictivePumpAssembly({ progressRef }: { progressRef: ProgressRef }) {
  const group = useRef<THREE.Group>(null)
  const impeller = useRef<THREE.Group>(null)
  const sensor = useRef<THREE.MeshStandardMaterial>(null)
  const blade = useMemo(() => {
    const shape = new THREE.Shape()
    shape.moveTo(.24, -.1)
    shape.bezierCurveTo(.56, -.08, .95, .08, 1.34, .48)
    shape.lineTo(1.47, .68)
    shape.bezierCurveTo(1.02, .35, .61, .24, .22, .2)
    shape.closePath()
    return shape
  }, [])

  useFrame(({ clock }) => {
    const progress = progressRef.current
    if (group.current) group.current.visible = progress > .554 && progress < .817
    if (impeller.current) impeller.current.rotation.z = clock.elapsedTime * .42
    if (sensor.current) sensor.current.emissiveIntensity = .72 + Math.sin(clock.elapsedTime * 2.1) * .16
  })

  return (
    <group ref={group} position={[0, 1, -23.6]} visible={false}>
      <mesh position={[0, .35, -7.05]} receiveShadow>
        <boxGeometry args={[9, 6.1, .32]} />
        <meshStandardMaterial color="#263431" roughness={.54} metalness={.54} envMapIntensity={.86} />
      </mesh>
      {[-4.1, 0, 4.1].map((x) => (
        <mesh key={x} position={[x, .35, -6.82]}>
          <boxGeometry args={[.13, 6.1, .12]} />
          <meshStandardMaterial color="#71817a" roughness={.34} metalness={.7} />
        </mesh>
      ))}
      {[-2.2, .35, 2.9].map((y) => (
        <mesh key={y} position={[0, y, -6.81]}>
          <boxGeometry args={[8.3, .105, .12]} />
          <meshStandardMaterial color="#596b65" roughness={.38} metalness={.65} />
        </mesh>
      ))}
      {[-2.85, 2.85].map((x, index) => (
        <group key={x} position={[x, .15, -5.85]}>
          <mesh><cylinderGeometry args={[.31, .31, 4.6, 36]} /><meshStandardMaterial color={index ? '#466762' : '#5c6d67'} roughness={.39} metalness={.63} /></mesh>
          {[-1.7, 0, 1.7].map((y) => (
            <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.32, .035, 10, 40]} /><meshStandardMaterial color="#8d9993" roughness={.31} metalness={.72} /></mesh>
          ))}
        </group>
      ))}
      {[-2.5, 0, 2.5].map((x) => (
        <group key={x} position={[x, 2.25, -6.58]}>
          <mesh><boxGeometry args={[1.25, .34, .14]} /><meshStandardMaterial color="#374842" roughness={.42} metalness={.55} /></mesh>
          <mesh position={[0, 0, .09]}><boxGeometry args={[.88, .07, .025]} /><meshStandardMaterial color="#d9e2c5" emissive="#d9e2c5" emissiveIntensity={.7} /></mesh>
        </group>
      ))}
      <mesh position={[0, -2.02, -2.65]} receiveShadow>
        <boxGeometry args={[8.25, .18, 8.15]} />
        <meshStandardMaterial color="#3d4a46" roughness={.62} metalness={.42} />
      </mesh>
      {[-3.65, 3.65].map((x) => (
        <group key={x} position={[x, -1.05, -3.25]}>
          <mesh><boxGeometry args={[.14, 1.8, 7.1]} /><meshStandardMaterial color="#66756f" roughness={.38} metalness={.66} /></mesh>
          {[-6.1, -4.35, -2.6, -.85].map((z) => (
            <mesh key={z} position={[0, .9, z + 3.25]}><boxGeometry args={[.28, .08, .08]} /><meshStandardMaterial color="#9ca69f" roughness={.31} metalness={.71} /></mesh>
          ))}
        </group>
      ))}
      {[-1.65, 1.65].flatMap((x) => [-.25, -4.7].map((z) => (
        <group key={`${x}-${z}`} position={[x, -1.9, z]}>
          <mesh><cylinderGeometry args={[.11, .11, .25, 18]} /><meshStandardMaterial color="#aab1ac" roughness={.3} metalness={.72} /></mesh>
          <mesh position={[0, .14, 0]}><cylinderGeometry args={[.19, .19, .055, 6]} /><meshStandardMaterial color="#69736d" roughness={.4} metalness={.62} /></mesh>
        </group>
      )))}

      <mesh position={[0, 0, -.18]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1.78, 1.78, .72, 72, 1, true]} />
        <meshStandardMaterial color="#3e504c" roughness={.34} metalness={.66} side={THREE.DoubleSide} envMapIntensity={1.2} />
      </mesh>
      <mesh position={[0, 0, -.25]} rotation={[0, 0, -.48]}>
        <torusGeometry args={[1.34, .34, 24, 112, Math.PI * 1.78]} />
        <meshStandardMaterial color="#435b57" roughness={.31} metalness={.68} envMapIntensity={1.25} />
      </mesh>
      <mesh><torusGeometry args={[1.8, .17, 18, 108]} /><meshStandardMaterial color="#7c8c87" roughness={.26} metalness={.76} envMapIntensity={1.3} /></mesh>
      {Array.from({ length: 12 }, (_, index) => index * Math.PI * 2 / 12).map((angle) => (
        <mesh key={angle} position={[Math.cos(angle) * 1.8, Math.sin(angle) * 1.8, .16]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[.048, .048, .15, 16]} />
          <meshStandardMaterial color="#b0b8b3" roughness={.25} metalness={.82} envMapIntensity={1.35} />
        </mesh>
      ))}
      <mesh position={[0, 0, -.04]} scale={[1.02, 1.02, .34]}>
        <sphereGeometry args={[1.87, 64, 28]} />
        <meshPhysicalMaterial color="#6d9696" roughness={.12} metalness={.18} clearcoat={.82} clearcoatRoughness={.14} transparent opacity={.18} depthWrite={false} side={THREE.DoubleSide} envMapIntensity={1.15} />
      </mesh>
      <group ref={impeller} position={[0, 0, .08]}>
        {Array.from({ length: 7 }, (_, index) => index * Math.PI * 2 / 7).map((angle) => (
          <mesh key={angle} rotation={[0, 0, angle]}>
            <extrudeGeometry args={[blade, { depth: .14, bevelEnabled: true, bevelSize: .025, bevelThickness: .025, bevelSegments: 2 }]} />
            <meshStandardMaterial color="#617c78" roughness={.2} metalness={.84} envMapIntensity={1.42} />
          </mesh>
        ))}
        <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.34, .34, .44, 48]} /><meshStandardMaterial color="#aeb9b3" roughness={.22} metalness={.82} envMapIntensity={1.35} /></mesh>
      </group>
      <mesh position={[0, 0, .24]}>
        <torusGeometry args={[.48, .09, 16, 72]} />
        <meshStandardMaterial color="#9ba8a2" roughness={.24} metalness={.78} envMapIntensity={1.3} />
      </mesh>
      <mesh position={[0, 0, -1.45]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.18, .18, 3.3, 28]} /><meshStandardMaterial color="#727c76" roughness={.34} metalness={.66} /></mesh>
      <mesh position={[0, 0, -4]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.76, .76, 3.65, 56]} /><meshStandardMaterial color="#364a47" roughness={.4} metalness={.62} envMapIntensity={1.1} /></mesh>
      {[-2.36, -2.78, -3.2, -3.62, -4.04, -4.46, -4.88, -5.3, -5.72].map((z) => (
        <mesh key={z} position={[0, 0, z]}><torusGeometry args={[.77, .035, 10, 56]} /><meshStandardMaterial color="#657772" roughness={.34} metalness={.68} /></mesh>
      ))}
      <mesh position={[0, 0, .47]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[.55, .55, .42, 48]} />
        <meshStandardMaterial color="#415955" roughness={.32} metalness={.67} envMapIntensity={1.18} />
      </mesh>
      <mesh position={[0, 0, .71]}><torusGeometry args={[.56, .105, 16, 64]} /><meshStandardMaterial color="#87958f" roughness={.25} metalness={.78} /></mesh>
      <mesh position={[1.48, 1.2, -.45]}>
        <cylinderGeometry args={[.34, .34, 2.5, 36]} />
        <meshStandardMaterial color="#66726c" roughness={.38} metalness={.58} />
      </mesh>
      <mesh position={[1.18, .58, -.45]} rotation={[0, 0, -.5]}>
        <cylinderGeometry args={[.35, .35, 1.45, 36]} />
        <meshStandardMaterial color="#5a6f69" roughness={.34} metalness={.66} envMapIntensity={1.12} />
      </mesh>
      <mesh position={[1.48, 2.43, -.45]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[.34, .11, 16, 64, Math.PI / 2]} />
        <meshStandardMaterial color="#7c8781" roughness={.34} metalness={.64} />
      </mesh>
      <mesh position={[.7, 1.52, .18]}><sphereGeometry args={[.055, 18, 12]} /><meshStandardMaterial ref={sensor} color={LIME} emissive={LIME} emissiveIntensity={.8} /></mesh>
      <WorldCallout progressRef={progressRef} position={[.7, 1.52, .18]} window={[.705, .72, .755, .775]} label="ОПОРНЫЙ ПОДШИПНИК" value="BRG-07A" meta="НАСОСНЫЙ АГРЕГАТ P-07" />
      <pointLight position={[0, .4, 1.1]} color="#b8dcdb" intensity={.55} distance={7} />
      <pointLight position={[0, 2.25, -5.9]} color="#dbe7cd" intensity={.42} distance={8.5} />
    </group>
  )
}

function TopologyLink({ start, end, phase = 0 }: { start: [number, number, number]; end: [number, number, number]; phase?: number }) {
  const material = useRef<THREE.ShaderMaterial>(null)
  const curve = useMemo(() => {
    const from = new THREE.Vector3(...start)
    const to = new THREE.Vector3(...end)
    const midpoint = from.clone().lerp(to, .5)
    midpoint.y += .28 + from.distanceTo(to) * .06
    return new THREE.QuadraticBezierCurve3(from, midpoint, to)
  }, [end, start])
  const geometry = useMemo(() => new THREE.TubeGeometry(curve, 48, .026, 8, false), [curve])
  useFrame(({ clock }) => {
    if (!material.current) return
    material.current.uniforms.uTime.value = clock.elapsedTime + phase
  })
  return (
    <mesh geometry={geometry}>
      <shaderMaterial
        ref={material}
        vertexShader={flowVertex}
        fragmentShader={flowFragment}
        uniforms={{ uTime: { value: 0 }, uOpacity: { value: .84 }, uColor: { value: new THREE.Color(phase % 2 ? ICE : LIME) } }}
        transparent
        depthWrite={false}
      />
    </mesh>
  )
}

function OperationalTopology({ progressRef }: { progressRef: ProgressRef }) {
  const { scene } = useGLTF(REFINERY_PARTS_URL)
  const group = useRef<THREE.Group>(null)
  const asset = useMemo(() => scene.clone(true), [scene])
  const materials = useMemo(() => [
    new THREE.MeshStandardMaterial({ color: '#536a64', emissive: '#102725', emissiveIntensity: .48, metalness: .58, roughness: .35, envMapIntensity: 1.2 }),
    new THREE.MeshStandardMaterial({ color: '#71847c', emissive: '#162d2a', emissiveIntensity: .42, metalness: .64, roughness: .3, envMapIntensity: 1.28 }),
    new THREE.MeshStandardMaterial({ color: '#354a47', emissive: '#0d2422', emissiveIntensity: .58, metalness: .52, roughness: .4, envMapIntensity: 1.12 }),
  ], [])
  const nodes = useMemo(() => [
    [-3.6, .82, -1.8], [-2.4, 1.45, .6], [-1.2, .65, 2.25], [0, 1.85, -.35],
    [1.35, .92, 1.85], [2.55, 1.5, -.75], [3.55, .72, 1.15],
  ] as Array<[number, number, number]>, [])

  useLayoutEffect(() => {
    normalizeModel(asset, 9.4)
    asset.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const signature = `${object.name}${object.geometry.uuid}`.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0)
      object.material = materials[signature % materials.length]
      object.castShadow = false
      object.receiveShadow = false
    })
    return () => materials.forEach((material) => material.dispose())
  }, [asset, materials])

  useFrame((_, delta) => {
    const reveal = smooth(progressRef.current, .79, .842)
    if (!group.current) return
    group.current.visible = reveal > .005
    const scale = THREE.MathUtils.damp(group.current.scale.x, .74 + reveal * .26, 4.2, delta)
    group.current.scale.setScalar(scale)
  })

  return (
    <group ref={group} position={[0, -.28, -14.5]} rotation={[0, -.28, 0]} visible={false}>
      <primitive object={asset} />
      <gridHelper args={[13, 26, '#62776f', '#34433e']} position={[0, -.015, 0]} />
      {nodes.map((node, index) => (
        <group key={`${node[0]}-${node[2]}`} position={node}>
          <mesh><sphereGeometry args={[index === 3 ? .09 : .065, 18, 12]} /><meshStandardMaterial color={index === 3 ? LIME : ICE} emissive={index === 3 ? LIME : ICE} emissiveIntensity={index === 3 ? 1.45 : .9} /></mesh>
          <mesh><sphereGeometry args={[index === 3 ? .23 : .17, 18, 12]} /><meshBasicMaterial color={index === 3 ? LIME : ICE} transparent opacity={.1} depthWrite={false} /></mesh>
        </group>
      ))}
      {nodes.slice(0, -1).map((node, index) => <TopologyLink key={index} start={node} end={nodes[index + 1]} phase={index * .47} />)}
      <TopologyLink start={nodes[0]} end={nodes[3]} phase={2.8} />
      <TopologyLink start={nodes[3]} end={nodes[6]} phase={3.6} />
      <pointLight position={[0, 4, 1]} color="#b7dfe0" intensity={.58} distance={13} />
    </group>
  )
}

type Keyframe = { at: number; value: [number, number, number] }

function sample(frames: Keyframe[], progress: number) {
  if (progress <= frames[0].at) return frames[0].value
  if (progress >= frames[frames.length - 1].at) return frames[frames.length - 1].value
  let segment = 0
  let current = frames[0]
  let next = frames[frames.length - 1]
  for (let index = 0; index < frames.length - 1; index += 1) {
    if (progress >= frames[index].at && progress <= frames[index + 1].at) {
      current = frames[index]
      next = frames[index + 1]
      segment = index
      break
    }
  }
  // Monotone Hermite tangents carry velocity across the pipe waypoints without
  // overshooting the narrow interior or stopping at each intermediate pose.
  if (progress > .428 && progress < .72) {
    const span = next.at - current.at
    const t = (progress - current.at) / span
    const t2 = t * t
    const t3 = t2 * t
    const tangent = (index: number, axis: number) => {
      if (index === 0 || index === frames.length - 1 || frames[index].at <= .428 || frames[index].at >= .72) return 0
      const left = (frames[index].value[axis] - frames[index - 1].value[axis]) / (frames[index].at - frames[index - 1].at)
      const right = (frames[index + 1].value[axis] - frames[index].value[axis]) / (frames[index + 1].at - frames[index].at)
      return left * right <= 0 ? 0 : 2 * left * right / (left + right)
    }
    return current.value.map((value, axis) => (
      (2 * t3 - 3 * t2 + 1) * value + (t3 - 2 * t2 + t) * span * tangent(segment, axis)
      + (-2 * t3 + 3 * t2) * next.value[axis] + (t3 - t2) * span * tangent(segment + 1, axis)
    )) as [number, number, number]
  }
  const local = smooth(progress, current.at, next.at)
  return current.value.map((value, index) => THREE.MathUtils.lerp(value, next.value[index], local)) as [number, number, number]
}

function CameraRig({ progressRef }: { progressRef: ProgressRef }) {
  const target = useRef(new THREE.Vector3())
  const cameraRoll = useRef(0)
  const positions = useMemo<Keyframe[]>(() => [
    { at: 0, value: [9.8, 1.85, 12.2] },
    { at: .075, value: [9.45, 1.92, 11.6] },
    { at: .14, value: [8.8, 2.08, 10.4] },
    { at: .285, value: [7.4, 2.35, 7.9] },
    { at: .36, value: [2.2, 1.6, 4.2] },
    { at: .428, value: [-2.8, 2.2, 4.3] },
    { at: .49, value: [-1.7, 1.65, 2.8] },
    { at: .535, value: [-.5, 1.16, .6] },
    { at: .57, value: [.08, 1.02, -.5] },
    { at: .60, value: [.12, 1.03, -2.1] },
    { at: .63, value: [.4, 1.06, -5.1] },
    { at: .65, value: [.86, 1.06, -7.7] },
    { at: .68, value: [.62, 1.0, -10.8] },
    { at: .72, value: [.16, 1.05, -15.2] },
    { at: .77, value: [5.2, 3.4, -17] },
    { at: .805, value: [6, 4.8, -10.5] },
    { at: .86, value: [5.2, 5.45, -10.4] },
    { at: .925, value: [7.2, 6.6, -8.2] },
    { at: 1, value: [7.2, 6.6, -8.2] },
  ], [])
  const targets = useMemo<Keyframe[]>(() => [
    { at: 0, value: [-.25, 1.25, .2] },
    { at: .12, value: [-.1, 1.2, .18] },
    { at: .2, value: [0, 1.18, .15] },
    { at: .285, value: [1.1, 1.08, 0] },
    { at: .36, value: [0, 1.05, .1] },
    { at: .428, value: [0, 1.15, .15] },
    { at: .49, value: [0, 1.0, -1.3] },
    { at: .535, value: [0, 1.0, -3.5] },
    { at: .57, value: [0, 1.0, -5.5] },
    { at: .595, value: [0, 1.0, -7] },
    { at: .625, value: [0, 1.0, -11] },
    { at: .65, value: [0, 1.0, -14.2] },
    { at: .68, value: [0, 1.0, -17.2] },
    { at: .72, value: [0, 1.0, -23.4] },
    { at: .77, value: [0, 1.0, -23.6] },
    { at: .805, value: [0, .72, -14.5] },
    { at: .86, value: [0, .8, -14.5] },
    { at: .925, value: [0, .55, -14.5] },
    { at: 1, value: [0, .55, -14.5] },
  ], [])
  const rolls = useMemo<Keyframe[]>(() => [
    { at: 0, value: [-.18, 0, 0] },
    { at: .14, value: [.1, 0, 0] },
    { at: .285, value: [-.42, 0, 0] },
    { at: .36, value: [.25, 0, 0] },
    { at: .428, value: [.48, 0, 0] },
    { at: .535, value: [-.32, 0, 0] },
    { at: .64, value: [.08, 0, 0] },
    { at: .705, value: [-.4, 0, 0] },
    { at: .77, value: [.24, 0, 0] },
    { at: .845, value: [0, 0, 0] },
    { at: 1, value: [0, 0, 0] },
  ], [])
  useFrame((state, delta) => {
    const camera = state.camera as THREE.PerspectiveCamera
    const p = progressRef.current
    const position = sample(positions, p)
    const desiredTarget = sample(targets, p)
    const desiredRoll = THREE.MathUtils.degToRad(sample(rolls, p)[0])
    const breathing = Math.sin(state.clock.elapsedTime * .22) * .012 * (1 - smooth(p, .72, .84))
    const parallax = 1 - sceneWindow(p, .45, .53, .72, .78)
    // Progress is already damped once for the whole scene. A second camera-only
    // lag would expose the exterior visibility switch during a fast scroll.
    camera.position.set(position[0] + state.pointer.x * .12 * parallax, position[1] + state.pointer.y * .07 * parallax + breathing, position[2])
    target.current.set(...desiredTarget)
    camera.lookAt(target.current)
    cameraRoll.current = THREE.MathUtils.damp(cameraRoll.current, desiredRoll, 2.1, delta)
    camera.rotateZ(cameraRoll.current)
    const heroFov = (1 - smooth(p, .1, .22)) * 2
    const macroFov = sceneWindow(p, .245, .3, .52, .57) * 3
    const velocityFov = sceneWindow(p, .55, .59, .69, .74) * 5.5
    const revealFov = sceneWindow(p, .71, .78, .9, .955) * 6
    const nextFov = 30 - heroFov - macroFov + velocityFov + revealFov
    const prior = camera.fov
    camera.fov = THREE.MathUtils.damp(prior, nextFov, 2.2, delta)
    if (Math.abs(prior - camera.fov) > .001) camera.updateProjectionMatrix()
  })
  return null
}

function World({ progressRef }: { progressRef: ProgressRef }) {
  return (
    <>
      <color attach="background" args={['#78a7b7']} />
      <fog attach="fog" args={['#a8c8c6', 31, 92]} />
      <SkyDome progressRef={progressRef} />
      <MountainHorizon progressRef={progressRef} />
      <VolumetricCloudBank progressRef={progressRef} />
      <CinematicAtmosphere progressRef={progressRef} />
      <PhysicalLighting progressRef={progressRef} />
      <PhysicalSkyEnvironment />
      <PremiumIndustrialPlant progressRef={progressRef} />
      <ContactShadows position={[0, -.48, 0]} opacity={.24} scale={30} blur={2.8} far={12} resolution={512} frames={1} color="#08100f" />
      <ProcessFlowCutaway progressRef={progressRef} />
      <PredictivePumpAssembly progressRef={progressRef} />
      <OperationalTopology progressRef={progressRef} />
      <BakeShadows />
      <CameraRig progressRef={progressRef} />
      <Preload all />
      <EffectComposer enableNormalPass multisampling={0} resolutionScale={.8}>
        <SSAO
          samples={14}
          rings={4}
          radius={.11}
          intensity={2.8}
          luminanceInfluence={.58}
          distanceThreshold={1}
          distanceFalloff={.18}
          rangeThreshold={.52}
          rangeFalloff={.12}
          color={AO_COLOR}
        />
        <Bloom mipmapBlur luminanceThreshold={1.05} luminanceSmoothing={.34} intensity={.35} radius={.6} />
        <Vignette offset={.16} darkness={.34} eskil={false} />
        <SMAA />
      </EffectComposer>
    </>
  )
}

useGLTF.setDecoderPath('/draco/')

const IndustrialScene = memo(function IndustrialScene({ progressRef, active = true }: { progressRef: ProgressRef; active?: boolean }) {
  return (
    <SceneErrorBoundary>
      <Canvas
        camera={{ position: [9.8, 1.85, 12.2], fov: 28, near: .05, far: 100 }}
        dpr={[1, 1.65]}
        frameloop={active ? 'always' : 'never'}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: .94, powerPreference: 'high-performance' }}
        shadows
      >
        <color attach="background" args={['#222d2f']} />
        <Suspense fallback={null}>
          <World progressRef={progressRef} />
        </Suspense>
      </Canvas>
      <SceneLoading />
    </SceneErrorBoundary>
  )
})

export default IndustrialScene

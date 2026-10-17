import {Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent} from "react";
import {Canvas, type ThreeEvent, useLoader, useThree} from "@react-three/fiber";
import {ThreeCanvas} from "@remotion/three";
import {Box3, PerspectiveCamera, Vector3, Texture, Raycaster, Vector2, type Material} from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js";
import {DRACOLoader} from "three/examples/jsm/loaders/DRACOLoader.js";
import {GLTFLoader} from "three/examples/jsm/loaders/GLTFLoader.js";
import {cancelRender, staticFile, getRemotionEnvironment, useCurrentFrame, useVideoConfig} from "remotion";
import type {Caption, VideoScene} from "../schema";
import type {CameraState, ModelPoint} from "./model-scene-schema";
import {MODEL_WIDTH, MODEL_HEIGHT, annotationLayout, annotationPointer, dragLabelOffset, type AnnotationPatch, type ModelAnnotation} from "./model-scene-annotations";
import {getCameraState, frameAtMs, msAtFrame} from "./model-scene-camera";
import {resolveModelSceneSchedule, type TimedModelAnnotation} from "./model-scene-timing";

export {MODEL_WIDTH, MODEL_HEIGHT} from "./model-scene-annotations";
export const cameraForState = (state: CameraState) => {
  const camera = new PerspectiveCamera(state.fov, MODEL_WIDTH / MODEL_HEIGHT, 0.01, 1000);
  camera.position.set(state.position.x, state.position.y, state.position.z);
  camera.lookAt(state.target.x, state.target.y, state.target.z);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  return camera;
};

// 控制器只响应鼠标事件，禁用惯性和自动旋转；播放时完全由帧驱动。
const CameraRig = ({state, interactive, onChange}: {state: CameraState; interactive?: boolean; onChange?: (state: CameraState) => void}) => {
  const {camera, gl, invalidate} = useThree();
  const controls = useRef<OrbitControls | null>(null);
  useLayoutEffect(() => {
    const next = cameraForState(state);
    camera.position.copy(next.position); camera.quaternion.copy(next.quaternion);
    (camera as PerspectiveCamera).fov = state.fov;
    (camera as PerspectiveCamera).updateProjectionMatrix(); camera.updateMatrixWorld();
    controls.current?.target.set(state.target.x, state.target.y, state.target.z);
    invalidate();
  }, [camera, state, invalidate]);
  useEffect(() => {
    if (!interactive) return;
    const orbit = new OrbitControls(camera, gl.domElement);
    controls.current = orbit;
    orbit.target.set(state.target.x, state.target.y, state.target.z);
    orbit.enableDamping = false; orbit.autoRotate = false; orbit.minDistance = 0.05; orbit.maxDistance = 100;
    orbit.update(); invalidate();
    const change = () => {invalidate(); onChange?.({position: {x: camera.position.x, y: camera.position.y, z: camera.position.z}, target: {x: orbit.target.x, y: orbit.target.y, z: orbit.target.z}, fov: (camera as PerspectiveCamera).fov});};
    orbit.addEventListener("change", change);
    return () => {orbit.removeEventListener("change", change); orbit.dispose(); controls.current = null;};
    // 姿态变化由上面的 layout effect 同步，不重建鼠标手势。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, gl, interactive, invalidate, onChange]);
  return null;
};

// 编辑和成片共用本地解码器，不依赖外部 CDN；复用实例避免重复创建 Worker。
let dracoLoader: DRACOLoader | undefined;
const configureModelLoader = (loader: GLTFLoader) => {
  dracoLoader ??= new DRACOLoader().setDecoderPath(staticFile("draco/")).setWorkerLimit(2);
  loader.setDRACOLoader(dracoLoader);
};

const LoadedModel = ({src, onPick, onReady}: {src: string; onPick?: (point: ModelPoint) => void; onReady: () => void}) => {
  const gltf = useLoader(GLTFLoader, src, configureModelLoader);
  const {gl, scene, camera} = useThree();
  const down = useRef<{x: number; y: number} | null>(null);
  const normalized = useMemo(() => {
    const object = gltf.scene.clone(true);
    const bounds = new Box3().setFromObject(object);
    const center = bounds.getCenter(new Vector3()); const size = bounds.getSize(new Vector3());
    const extent = Math.max(size.x, size.y, size.z);
    if (bounds.isEmpty() || !Number.isFinite(extent) || extent <= 0) throw new Error("GLB 没有可展示的几何体");
    const scale = 2 / extent;
    return {object, position: [-center.x * scale, -center.y * scale, -center.z * scale] as [number, number, number], scale};
  }, [gltf.scene]);
  useLayoutEffect(() => {
    // GLTFLoader 已等待图片解码；提交前初始化纹理并编译材质，避免首帧空白。
    normalized.object.traverse((node) => {
      const material = (node as unknown as {material?: Material | Material[]}).material;
      for (const item of Array.isArray(material) ? material : material ? [material] : []) {
        for (const value of Object.values(item)) if (value instanceof Texture) gl.initTexture(value);
      }
    });
    gl.compile(scene, camera); onReady();
  }, [normalized, gl, scene, camera, onReady]);
  const pick = (event: ThreeEvent<PointerEvent>) => {
    if (!onPick || !down.current || Math.hypot(event.clientX - down.current.x, event.clientY - down.current.y) > 4) return;
    event.stopPropagation(); onPick({x: event.point.x, y: event.point.y, z: event.point.z}); down.current = null;
  };
  // 外层归一化保留 GLB 根节点自身的位移、缩放和旋转。
  return <group position={normalized.position} scale={normalized.scale}><primitive object={normalized.object} dispose={null} onPointerDown={(e: ThreeEvent<PointerEvent>) => {if (e.button === 0) down.current = {x: e.clientX, y: e.clientY};}} onPointerUp={pick} /></group>;
};
const Lights = () => <><ambientLight intensity={1.7} /><directionalLight intensity={2.8} position={[3, 5, 5]} /><directionalLight intensity={1.2} position={[-4, 1, -3]} /></>;

class ModelErrorBoundary extends Component<{children: ReactNode}, {error: string | null}> {
  state: {error: string | null} = {error: null};
  static getDerivedStateFromError(error: Error) {return {error: error.message};}
  componentDidCatch(error: Error) {if (getRemotionEnvironment().isRendering) cancelRender(error);}
  render() {return this.state.error ? <div role="alert" className="model-load-error">模型加载失败：{this.state.error}</div> : this.props.children;}
}
const LoadTimeout = ({ready}: {ready: boolean}) => {
  const [expired, setExpired] = useState(false);
  useEffect(() => {if (ready) return; const timer = setTimeout(() => setExpired(true), 45000); return () => clearTimeout(timer);}, [ready]);
  if (expired && !ready) throw new Error("GLB 加载超过 45 秒，请检查文件后重试");
  return null;
};
type AnnotationEditing = {selectedId: string | null; onSelect: (id: string) => void; onCommit: (id: string, patch: AnnotationPatch) => void};
type SurfacePicker = (clientX: number, clientY: number) => ModelPoint | null;
const SurfaceRaycast = ({picker}: {picker: React.MutableRefObject<SurfacePicker | null>}) => {
  const {camera, scene, gl} = useThree();
  useLayoutEffect(() => {
    const raycaster = new Raycaster();
    picker.current = (clientX, clientY) => {
      const rect = gl.domElement.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
      camera.updateMatrixWorld(); scene.updateMatrixWorld(true);
      raycaster.setFromCamera(new Vector2((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2), camera);
      const hit = raycaster.intersectObjects(scene.children, true)[0];
      return hit ? {x: hit.point.x, y: hit.point.y, z: hit.point.z} : null;
    };
    return () => {picker.current = null;};
  }, [camera, scene, gl, picker]);
  return null;
};
export const ModelAnnotations = ({annotations, state, selectedId, onBegin, onMove, onEnd, onCancel}: {
  annotations: TimedModelAnnotation[]; state: CameraState; selectedId?: string | null;
  onBegin?: (id: string, kind: "label" | "anchor", event: ReactPointerEvent<SVGElement>) => void;
  onMove?: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onEnd?: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onCancel?: () => void;
}) => {
  const camera = cameraForState(state);
  return <svg viewBox={`0 0 ${MODEL_WIDTH} ${MODEL_HEIGHT}`} style={{position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "hidden"}} onPointerMove={onMove} onPointerUp={onEnd} onPointerCancel={onCancel} onLostPointerCapture={onCancel}>
    {[...annotations].sort((a, b) => a.id === selectedId ? 1 : b.id === selectedId ? -1 : 0).map((annotation) => {
      if (!annotation.anchor) return null;
      const projected = new Vector3(annotation.anchor.x, annotation.anchor.y, annotation.anchor.z).project(camera);
      if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) return null;
      const anchor = {x: (projected.x + 1) / 2 * MODEL_WIDTH, y: (1 - projected.y) / 2 * MODEL_HEIGHT};
      const layout = annotationLayout(annotation, anchor);
      const {style, width, height, x, y, lines, lineHeight, center, end} = layout;
      const selected = selectedId === annotation.id;
      return <g key={annotation.id}>
        {style.showLine ? <><path d={`M ${anchor.x} ${anchor.y} L ${(anchor.x + end.x) / 2} ${end.y} L ${end.x} ${end.y}`} stroke={style.accentColor} strokeWidth={3} fill="none" /><circle cx={anchor.x} cy={anchor.y} r={5} fill={style.accentColor} /></> : null}
        {style.preset === "bubble" && style.showLine ? <path d={`M ${end.x - 8} ${end.y} L ${anchor.x} ${anchor.y} L ${end.x + 8} ${end.y} Z`} fill={style.backgroundColor} stroke={style.accentColor} strokeWidth={2} /> : null}
        <g style={{pointerEvents: onBegin ? "auto" : "none", cursor: onBegin ? "grab" : undefined, touchAction: "none"}} onPointerDown={(event) => onBegin?.(annotation.id, "label", event)}>
          <rect x={x} y={y} width={width} height={height} rx={style.preset === "tag" ? height / 2 : style.preset === "bubble" ? 18 : 8} fill={style.backgroundColor} stroke={selected ? "#d17a15" : style.accentColor} strokeWidth={selected ? 4 : 2} />
          <text fill={style.textColor} fontSize={style.fontSize} fontFamily="Studio Sans, PingFang SC, Microsoft YaHei, sans-serif" fontWeight={700} textAnchor="middle" style={{userSelect: "none"}}>{lines.map((line, index) => <tspan key={index} textLength={line ? layout.lineWidths[index] : undefined} lengthAdjust="spacingAndGlyphs" x={center.x} y={y + 11 + lineHeight * (index + 0.78)}>{line}</tspan>)}</text>
        </g>
        {selected && onBegin ? <circle aria-label="拖动部件锚点" cx={anchor.x} cy={anchor.y} r={10} fill="white" stroke={style.accentColor} strokeWidth={4} style={{pointerEvents: "auto", cursor: "crosshair", touchAction: "none"}} onPointerDown={(event) => onBegin(annotation.id, "anchor", event)} /> : null}
      </g>;
    })}
  </svg>;
};
// 两种画布共享模型、光照、相机与投影；编辑器保留原始画幅比例。
const ModelCanvas = ({src, state, editing, interactive, onChange, onPick, annotations = [], onLoadState, annotationEditing}: {src: string; state: CameraState; editing?: boolean; interactive?: boolean; onChange?: (state: CameraState) => void; onPick?: (point: ModelPoint) => void; annotations?: TimedModelAnnotation[]; onLoadState?: (ready: boolean) => void; annotationEditing?: AnnotationEditing}) => {
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {onLoadState?.(ready);}, [onLoadState, ready]);
  const onReady = useMemo(() => () => setReady(true), []);
  const picker = useRef<SurfacePicker | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{id: string; kind: "label" | "anchor"; initial: ModelAnnotation; pointer: {x: number; y: number}; center: {x: number; y: number}; anchor: {x: number; y: number}; pointerId: number; patch: AnnotationPatch | null; moved: boolean} | null>(null);
  const [preview, setPreview] = useState<{id: string; patch: AnnotationPatch} | null>(null);
  const begin = (id: string, kind: "label" | "anchor", event: ReactPointerEvent<SVGElement>) => {
    if (event.button !== 0 || !annotationEditing || !root.current) return;
    const annotation = annotations.find((a) => a.id === id);
    if (!annotation?.anchor) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    const point = new Vector3(annotation.anchor.x, annotation.anchor.y, annotation.anchor.z).project(cameraForState(state));
    const anchor = {x: (point.x + 1) / 2 * MODEL_WIDTH, y: (1 - point.y) / 2 * MODEL_HEIGHT};
    drag.current = {id, kind, initial: annotation, pointer: annotationPointer({x: event.clientX, y: event.clientY}, root.current.getBoundingClientRect()), center: annotationLayout(annotation, anchor).center, anchor, pointerId: event.pointerId, patch: null, moved: false};
    setPreview({id, patch: {}}); annotationEditing.onSelect(id);
  };
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId || !root.current) return;
    event.preventDefault(); event.stopPropagation();
    const pointer = annotationPointer({x: event.clientX, y: event.clientY}, root.current.getBoundingClientRect());
    active.moved ||= Math.hypot(pointer.x - active.pointer.x, pointer.y - active.pointer.y) > 2;
    if (active.kind === "label") active.patch = {labelOffset: dragLabelOffset(active.initial, active.anchor, {x: active.center.x + pointer.x - active.pointer.x, y: active.center.y + pointer.y - active.pointer.y})};
    else {const anchor = picker.current?.(event.clientX, event.clientY); active.patch = anchor ? {anchor} : null;}
    setPreview({id: active.id, patch: active.patch ?? {}});
  };
  const cancel = () => {drag.current = null; setPreview(null);};
  const end = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    move(event);
    // 释放到模型外时取消锚点移动；一次完整手势只提交一次。
    const patch = active.patch;
    cancel();
    if (active.moved && patch) annotationEditing?.onCommit(active.id, patch);
  };
  const displayed = annotations.map((a) => preview?.id === a.id ? {...a, ...preview.patch} : a);
  const children = <><CameraRig state={state} interactive={interactive && !preview} onChange={onChange} /><Lights /><SurfaceRaycast picker={picker} /><Suspense fallback={null}><LoadedModel src={src} onPick={onPick} onReady={onReady} /></Suspense></>;
  return <div ref={root} style={{position: "relative", width: "100%", aspectRatio: `${MODEL_WIDTH} / ${MODEL_HEIGHT}`, overflow: "hidden", borderRadius: 16, background: "#e8eee9", containerType: "inline-size", boxShadow: "inset 0 0 0 2px #26372f"}}>
    <ModelErrorBoundary key={`${src}-${attempt}`}><LoadTimeout ready={ready} />{editing ? <Canvas dpr={1} frameloop="demand" camera={{fov: state.fov, near: 0.01, far: 1000}} gl={{preserveDrawingBuffer: true}}>{children}</Canvas> : <ThreeCanvas dpr={1} width={MODEL_WIDTH} height={MODEL_HEIGHT} camera={{fov: state.fov, near: 0.01, far: 1000}} gl={{preserveDrawingBuffer: true}}>{/* Suspense 交由 ThreeCanvas 持有 Remotion 等待锁。 */}<CameraRig state={state} /><Lights /><LoadedModel src={src} onReady={onReady} /></ThreeCanvas>}</ModelErrorBoundary>
    {!ready && editing ? <div className="model-load-status">正在加载 GLB…</div> : null}
    {editing ? <button type="button" className="secondary model-retry" title="重新加载模型及纹理；不会清除已记录的关键帧和标注。" onClick={() => {useLoader.clear(GLTFLoader, src); setReady(false); setAttempt((n) => n + 1);}}>重新加载</button> : null}
    <ModelAnnotations annotations={displayed} state={state} selectedId={annotationEditing?.selectedId} onBegin={annotationEditing ? begin : undefined} onMove={move} onEnd={end} onCancel={cancel} />
  </div>;
};
export const ModelViewport = ModelCanvas;
export const ModelScene = ({scene, captions}: {scene: VideoScene; captions: Caption[]}) => {
  const frame = useCurrentFrame(); const {fps} = useVideoConfig();
  const schedule = resolveModelSceneSchedule(scene, captions, scene.templateData, fps);
  const nowMs = msAtFrame(frameAtMs(scene.startMs, fps) + frame, fps);
  const state = getCameraState(frame, schedule.track);
  const src = schedule.data.modelPath.replace(/^artifact:\/\//, "");
  return <div style={{width: MODEL_WIDTH, height: MODEL_HEIGHT}}><ModelCanvas key={src} src={src} state={state} annotations={schedule.annotations.filter((a) => nowMs >= a.startMs && nowMs < a.endMs)} /></div>;
};

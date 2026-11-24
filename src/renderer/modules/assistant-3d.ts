import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { loadNozomiAsset } from "./assistant-3d-asset";

import {
    AssistantMotion,
    MotionSpring,
    SOFT_ANIMATIONS,
} from "./assistant-3d-motion";
export const NOZOMI_ANIMATIONS = SOFT_ANIMATIONS;
type Callbacks = {
    ready: () => void;
    error: (reason: unknown) => void;
    headRegion?: (region: {
        left: number;
        top: number;
        width: number;
        height: number;
    }) => void;
};
export function mount3DAssistant(host: HTMLElement, callbacks: Callbacks) {
    let disposed = false,
        ready = false,
        frame = 0,
        last = 0;
    const motion = new AssistantMotion();
    const scene = new THREE.Scene(),
        rig = new THREE.Group(),
        camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.domElement.className = "assistant-3d-canvas";
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.append(renderer.domElement);
    host.dataset.assistantRuntime = "3d";
    scene.add(rig);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb7bdd0, 2));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(-2, 4, 5);
    scene.add(key);
    const bones = new Map<string, any>(),
        rests = new Map<any, any>(),
        morphs: any[] = [];
    let model: any,
        modelHeight = 2.15,
        centerY = 1.07;
    const armChains = new Map<string, any>(),
        legChains = new Map<string, any>(),
        secondary: any[] = [];
    let lastHeadZ = 0;
    function resize() {
        if (disposed) return;
        const w = host.clientWidth || 190,
            h = host.clientHeight || 270,
            half = modelHeight * 0.54;
        renderer.setSize(w, h, false);
        camera.left = (-half * w) / h;
        camera.right = (half * w) / h;
        camera.top = half;
        camera.bottom = -half;
        camera.position.set(0, centerY, 8);
        camera.lookAt(0, centerY, 0);
        camera.updateProjectionMatrix();
        const head = bones.get("head");
        if (head) {
            model.updateMatrixWorld(true);
            const point = head.getWorldPosition(new THREE.Vector3());
            point.y += 0.14;
            point.project(camera);
            const scale = h / (half * 2),
                width = 0.4 * scale,
                height = 0.43 * scale;
            callbacks.headRegion?.({
                left: ((point.x + 1) * w) / 2 - width / 2,
                top: ((1 - point.y) * h) / 2 - height / 2,
                width,
                height,
            });
        }
    }
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const setBone = (name: string, x = 0, y = 0, z = 0) => {
        const b = bones.get(name);
        if (!b) return;
        const r = rests.get(b);
        b.quaternion
            .copy(r.quaternion)
            .multiply(
                new THREE.Quaternion().setFromEuler(
                    new THREE.Euler(x, y, z, "XYZ"),
                ),
            );
    };
    function expression(name: string, value: number) {
        const entry = morphs.find((m) => m.name === name);
        if (!entry) return;
        for (const bind of entry.binds)
            for (const mesh of bind.meshes)
                if (mesh.morphTargetInfluences)
                    mesh.morphTargetInfluences[bind.index] = Math.max(
                        mesh.morphTargetInfluences[bind.index] || 0,
                        value * bind.weight,
                    );
    }
    function aimBone(bone: any, child: any, target: THREE.Vector3) {
        const origin = bone.getWorldPosition(new THREE.Vector3()),
            direction = child
                .getWorldPosition(new THREE.Vector3())
                .sub(origin)
                .normalize(),
            goal = target.clone().sub(origin).normalize();
        const rotation = new THREE.Quaternion()
            .setFromUnitVectors(direction, goal)
            .multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
        bone.quaternion.copy(
            bone.parent
                .getWorldQuaternion(new THREE.Quaternion())
                .invert()
                .multiply(rotation),
        );
        bone.updateWorldMatrix(false, true);
    }
    /** Two-bone IK keeps the elbow below/outside the hand instead of rotating arms through the torso. */
    function solveHand(
        side: string,
        offset: number[],
        poleOffset: number[],
        facing: number,
        wrist: number,
        orientation: number[],
    ) {
        const chain = armChains.get(side);
        if (!chain) return;
        const { upper, lower, hand, a, b } = chain;
        const origin = upper.getWorldPosition(new THREE.Vector3()),
            local = model.worldToLocal(origin.clone()),
            scale = (a + b) / 0.51;
        const target = model.localToWorld(
            local
                .clone()
                .add(
                    new THREE.Vector3(
                        ...(offset as [number, number, number]),
                    ).multiplyScalar(scale),
                ),
        );
        const pole = model.localToWorld(
            local
                .clone()
                .add(
                    new THREE.Vector3(
                        ...(poleOffset as [number, number, number]),
                    ).multiplyScalar(scale),
                ),
        );
        const delta = target.clone().sub(origin),
            distance = Math.min(
                a + b - 0.002,
                Math.max(Math.abs(a - b) + 0.002, delta.length()),
            ),
            direction = delta.normalize();
        const along = (a * a - b * b + distance * distance) / (2 * distance),
            height = Math.sqrt(Math.max(0, a * a - along * along)),
            bend = pole.sub(origin);
        bend.addScaledVector(direction, -bend.dot(direction)).normalize();
        const elbow = origin
                .clone()
                .addScaledVector(direction, along)
                .addScaledVector(bend, height),
            end = origin.clone().addScaledVector(direction, distance);
        aimBone(upper, lower, elbow);
        aimBone(lower, hand, end);
        if (facing > 0.001) {
            const q = model
                .getWorldQuaternion(new THREE.Quaternion())
                .multiply(
                    new THREE.Quaternion().setFromEuler(
                        new THREE.Euler(
                            orientation[0],
                            orientation[1],
                            orientation[2] + wrist,
                        ),
                    ),
                );
            q.premultiply(
                hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert(),
            );
            hand.quaternion.slerp(q, facing);
        }
    }
    function keepFootGrounded(side: string) {
        const chain = legChains.get(side);
        if (!chain) return;
        const { upper, lower, foot, a, b, target, orientation } = chain;
        const origin = upper.getWorldPosition(new THREE.Vector3()),
            direction = target.clone().sub(origin),
            distance = Math.min(
                a + b - 0.0001,
                Math.max(Math.abs(a - b) + 0.0001, direction.length()),
            );
        direction.normalize();
        const local = model.worldToLocal(origin.clone()),
            pole = model
                .localToWorld(
                    local.add(
                        new THREE.Vector3(
                            side === "right" ? 0.02 : -0.02,
                            -0.3,
                            -0.4,
                        ),
                    ),
                )
                .sub(origin);
        pole.addScaledVector(direction, -pole.dot(direction)).normalize();
        const along = (a * a - b * b + distance * distance) / (2 * distance),
            height = Math.sqrt(Math.max(0, a * a - along * along)),
            knee = origin
                .clone()
                .addScaledVector(direction, along)
                .addScaledVector(pole, height);
        aimBone(upper, lower, knee);
        aimBone(lower, foot, target);
        foot.quaternion.copy(
            foot.parent
                .getWorldQuaternion(new THREE.Quaternion())
                .invert()
                .multiply(orientation),
        );
    }
    function update(dt: number) {
        const pose = motion.update(dt);
        for (const [name, angles] of Object.entries(pose.bones))
            setBone(name, ...angles);
        const hips = bones.get("hips");
        if (hips)
            hips.position
                .copy(rests.get(hips).position)
                .add(new THREE.Vector3(...pose.hipShift));
        model.updateMatrixWorld(true);
        for (const side of ["left", "right"]) keepFootGrounded(side);
        for (const side of ["left", "right"] as const)
            solveHand(
                side,
                pose.hands[side],
                pose.poles[side],
                pose.facing[side],
                pose.wrist[side],
                pose.orientation[side],
            );
        for (const mesh of model.userData.morphMeshes)
            mesh.morphTargetInfluences.fill(0);
        for (const [name, value] of Object.entries(pose.expressions))
            expression(name, value);
        const headZ = pose.bones.head[2],
            velocity = (headZ - lastHeadZ) / Math.max(0.001, dt);
        lastHeadZ = headZ;
        for (const part of secondary) {
            const z = part.spring.step(
                    -velocity * 0.024 +
                        Math.sin(motion.time * 1.17 - part.depth * 0.15) *
                            0.0035,
                    dt,
                    9,
                ),
                rest = rests.get(part.node);
            part.node.quaternion
                .copy(rest.quaternion)
                .multiply(
                    new THREE.Quaternion().setFromEuler(
                        new THREE.Euler(0, 0, z),
                    ),
                );
        }
        host.dataset.animation = pose.mode;
        renderer.render(scene, camera);
    }
    function tick(now: number) {
        if (disposed) return;
        frame = requestAnimationFrame(tick);
        if (document.hidden) {
            last = now;
            return;
        }
        if (now - last < (motion.mode === "Idle" ? 32 : 16)) return;
        const dt = Math.min((now - last) / 1000, 1);
        last = now;
        if (ready) update(dt);
    }
    async function load() {
        try {
            const asset = await loadNozomiAsset();
            if (disposed) return;
            const gltf = await new GLTFLoader().parseAsync(asset.buffer, "");
            if (disposed) {
                disposeScene(gltf.scene);
                return;
            }
            model = gltf.scene;
            // A desktop mascot does not need the source's 4K textures in GPU memory.
            const textures = new Set<any>();
            model.traverse((node: any) => {
                for (const material of Array.isArray(node.material)
                    ? node.material
                    : node.material
                      ? [node.material]
                      : [])
                    for (const value of Object.values(material))
                        if ((value as any)?.isTexture) textures.add(value);
            });
            const resized = new Map<any, any>();
            for (const texture of textures) {
                const image = texture.image;
                if (!image || Math.max(image.width, image.height) <= 1024)
                    continue;
                let small = resized.get(image);
                if (!small) {
                    const scale = 1024 / Math.max(image.width, image.height);
                    small = await createImageBitmap(image, {
                        resizeWidth: Math.round(image.width * scale),
                        resizeHeight: Math.round(image.height * scale),
                        resizeQuality: "high",
                    });
                    resized.set(image, small);
                }
                texture.image = small;
                texture.needsUpdate = true;
            }
            for (const image of resized.keys()) image.close?.();
            if (disposed) {
                disposeScene(model);
                return;
            }
            model.rotation.y = Math.PI;
            rig.add(model);
            const meshByIndex = new Map<number, any[]>();
            model.userData.morphMeshes = [];
            model.traverse((node: any) => {
                if (node.isBone)
                    rests.set(node, {
                        position: node.position.clone(),
                        quaternion: node.quaternion.clone(),
                    });
                if (node.isMesh) {
                    node.frustumCulled = false;
                    const association = gltf.parser.associations.get(node);
                    if (association?.meshes != null)
                        meshByIndex.set(association.meshes, [
                            ...(meshByIndex.get(association.meshes) || []),
                            node,
                        ]);
                    if (node.morphTargetInfluences)
                        model.userData.morphMeshes.push(node);
                }
            });
            for (const b of asset.vrm.humanoid.humanBones) {
                const node = await gltf.parser.getDependency("node", b.node);
                bones.set(b.bone, node);
                if (!rests.has(node))
                    rests.set(node, {
                        position: node.position.clone(),
                        quaternion: node.quaternion.clone(),
                    });
            }
            for (const group of asset.vrm.blendShapeMaster.blendShapeGroups)
                morphs.push({
                    name: group.name,
                    binds: group.binds.map((b: any) => ({
                        meshes: meshByIndex.get(b.mesh) || [],
                        index: b.index,
                        weight: b.weight / 100,
                    })),
                });
            model.updateMatrixWorld(true);
            for (const side of ["left", "right"]) {
                const upper = bones.get(side + "UpperArm"),
                    lower = bones.get(side + "LowerArm"),
                    hand = bones.get(side + "Hand");
                if (upper && lower && hand)
                    armChains.set(side, {
                        upper,
                        lower,
                        hand,
                        a: upper
                            .getWorldPosition(new THREE.Vector3())
                            .distanceTo(
                                lower.getWorldPosition(new THREE.Vector3()),
                            ),
                        b: lower
                            .getWorldPosition(new THREE.Vector3())
                            .distanceTo(
                                hand.getWorldPosition(new THREE.Vector3()),
                            ),
                    });
            }
            for (const side of ["left", "right"]) {
                const upper = bones.get(side + "UpperLeg"),
                    lower = bones.get(side + "LowerLeg"),
                    foot = bones.get(side + "Foot");
                if (upper && lower && foot)
                    legChains.set(side, {
                        upper,
                        lower,
                        foot,
                        a: upper
                            .getWorldPosition(new THREE.Vector3())
                            .distanceTo(
                                lower.getWorldPosition(new THREE.Vector3()),
                            ),
                        b: lower
                            .getWorldPosition(new THREE.Vector3())
                            .distanceTo(
                                foot.getWorldPosition(new THREE.Vector3()),
                            ),
                        target: foot.getWorldPosition(new THREE.Vector3()),
                        orientation: foot.getWorldQuaternion(
                            new THREE.Quaternion(),
                        ),
                    });
            }
            model.traverse((node: any) => {
                if (rests.has(node) && /^(hair|ribbon|tail)/i.test(node.name)) {
                    let depth = 0;
                    for (
                        let p = node.parent;
                        p && p !== bones.get("head");
                        p = p.parent
                    )
                        depth++;
                    secondary.push({ node, depth, spring: new MotionSpring() });
                }
            });
            setBone("leftUpperArm", 0, 0, 1.27);
            setBone("rightUpperArm", 0, 0, -1.27);
            model.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(model);
            modelHeight = box.max.y - box.min.y;
            centerY = (box.max.y + box.min.y) / 2;
            resize();
            ready = true;
            play("Saluto");
            callbacks.ready();
        } catch (error) {
            if (!disposed) callbacks.error(error);
        }
    }
    function play(name: string, duration?: number) {
        return ready && motion.play(name, duration);
    }
    function disposeScene(root: any) {
        root.traverse((node: any) => {
            node.geometry?.dispose();
            for (const material of Array.isArray(node.material)
                ? node.material
                : node.material
                  ? [node.material]
                  : []) {
                for (const value of Object.values(material))
                    if ((value as any)?.isTexture) {
                        (value as any).source?.data?.close?.();
                        (value as any).dispose();
                    }
                material.dispose();
            }
        });
    }
    frame = requestAnimationFrame(tick);
    resize();
    void load();
    return {
        play,
        isReady: () => ready,
        snapshot: () => ({
            ...motion.snapshot(),
            ready,
            expressions: morphs.length,
            footDrift: [...legChains.values()].map((c) =>
                c.foot
                    .getWorldPosition(new THREE.Vector3())
                    .distanceTo(c.target),
            ),
            head: bones.get("head")?.rotation.toArray(),
            rightArm: bones.get("rightUpperArm")?.rotation.toArray(),
            rightForearm: bones.get("rightLowerArm")?.rotation.toArray(),
        }),
        startPat: () => play("Pat-pat"),
        stopPat: () => play("Fine carezza", 1.6),
        gaze: (x: number, y: number) => motion.look(x, y),
        dispose() {
            if (disposed) return;
            disposed = true;
            observer.disconnect();
            cancelAnimationFrame(frame);
            if (model) disposeScene(model);
            renderer.dispose();
            renderer.forceContextLoss();
            renderer.domElement.remove();
            delete host.dataset.assistantRuntime;
            delete host.dataset.animation;
        },
    };
}

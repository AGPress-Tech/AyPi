// Authored small gestures, expressed in the neutral VRM coordinate system.
// Cafe reference was inspected for timing/anticipation; no game tracks or models are shipped.
export type V3 = [number, number, number];
export const SOFT_ANIMATIONS = [
    { name: "Idle", duration: 5.4 },
    { name: "Saluto", duration: 5.4 },
    { name: "Contenta", duration: 5.2 },
    { name: "Curiosa", duration: 5.6 },
    { name: "Assenso", duration: 4.5 },
    { name: "Sbadiglio", duration: 6.4 },
    { name: "Pat-pat", duration: 3 },
    { name: "Fine carezza", duration: 1.6 },
];
type Key = [number, number];
/** Cubic Hermite with bounded, monotone slopes: smooth holds without joint overshoot. */
export function motionCurve(keys: Key[], time: number) {
    if (time <= keys[0][0]) return keys[0][1];
    if (time >= keys[keys.length - 1][0]) return keys[keys.length - 1][1];
    let i = 0;
    while (keys[i + 1][0] < time) i++;
    const slope = (j: number) => {
        if (j === 0 || j === keys.length - 1) return 0;
        const a = (keys[j][1] - keys[j - 1][1]) / (keys[j][0] - keys[j - 1][0]),
            b = (keys[j + 1][1] - keys[j][1]) / (keys[j + 1][0] - keys[j][0]);
        return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
    };
    const [ta, a] = keys[i],
        [tb, b] = keys[i + 1],
        d = tb - ta,
        t = (time - ta) / d,
        t2 = t * t,
        t3 = t2 * t;
    return (
        (2 * t3 - 3 * t2 + 1) * a +
        (t3 - 2 * t2 + t) * d * slope(i) +
        (-2 * t3 + 3 * t2) * b +
        (t3 - t2) * d * slope(i + 1)
    );
}
export class MotionSpring {
    value: number;
    velocity = 0;
    constructor(initial = 0) {
        this.value = initial;
    }
    step(target: number, dt: number, frequency = 16) {
        const offset = this.value - target,
            c = this.velocity + frequency * offset,
            e = Math.exp(-frequency * dt);
        this.value = target + (offset + c * dt) * e;
        this.velocity = (this.velocity - frequency * c * dt) * e;
        return this.value;
    }
}
export type SoftPose = {
    bones: Record<string, V3>;
    hands: { left: V3; right: V3 };
    poles: { left: V3; right: V3 };
    facing: { left: number; right: number };
    wrist: { left: number; right: number };
    orientation: { left: V3; right: V3 };
    hipShift: V3;
    expressions: Record<string, number>;
    mode: string;
};
const NEUTRAL_HAND = {
    left: [-0.09, -0.5, -0.045] as V3,
    right: [0.09, -0.5, -0.045] as V3,
};
const ramp = (time: number, delay = 0, end = 5.4) =>
    motionCurve(
        [
            [0, 0],
            [0.25 + delay, 0],
            [1.15 + delay, 1],
            [end - 1.35, 1],
            [end - 0.2, 0],
            [end, 0],
        ],
        time,
    );
const mix = (a: V3, b: V3, t: number): V3 =>
    a.map((v, i) => v + (b[i] - v) * t) as V3;
export class AssistantMotion {
    time = 0;
    mode = "Idle";
    private start = 0;
    private duration = 0;
    private loop = false;
    private nextBlink = 2.7;
    private blinkAt = -10;
    private springs = new Map<string, MotionSpring>();
    private gaze = { x: 0, y: 0 };
    constructor(private random = () => Math.random()) {}
    play(name: string, duration?: number) {
        if (!SOFT_ANIMATIONS.some((a) => a.name === name)) return false;
        this.mode = name;
        this.start = this.time;
        this.loop = duration === Infinity;
        this.duration = this.loop
            ? SOFT_ANIMATIONS.find((a) => a.name === name)!.duration
            : (duration ??
              SOFT_ANIMATIONS.find((a) => a.name === name)!.duration);
        return true;
    }
    look(x: number, y: number) {
        this.gaze = {
            x: Math.max(-1, Math.min(1, x)),
            y: Math.max(-1, Math.min(1, y)),
        };
    }
    private smooth(
        key: string,
        target: number,
        dt: number,
        frequency = 16,
        initial = 0,
    ) {
        let spring = this.springs.get(key);
        if (!spring) {
            spring = new MotionSpring(initial);
            this.springs.set(key, spring);
        }
        return spring.step(target, dt, frequency);
    }
    update(dt: number): SoftPose {
        this.time += dt;
        const t = this.time,
            definition = SOFT_ANIMATIONS.find((a) => a.name === this.mode)!,
            age = t - this.start;
        if (
            this.mode !== "Idle" &&
            this.mode !== "Pat-pat" &&
            !this.loop &&
            age > this.duration
        )
            this.mode = "Idle";
        const phase = this.loop
                ? age % definition.duration
                : (age * definition.duration) / Math.max(0.1, this.duration),
            mode = this.mode;
        const breath = Math.sin(t * 1.17),
            breatheDelayed = Math.sin(t * 1.17 - 0.24),
            weight = Math.sin(t * 0.48);
        const bones: Record<string, V3> = {
            spine: [0.004 * breath, 0.006 * Math.sin(t * 0.31), 0.008 * weight],
            neck: [-0.003 * breath, 0, 0],
            head: [-0.012 + 0.004 * breatheDelayed, 0, -0.005 * weight],
            leftShoulder: [0, 0, -0.008 * breath],
            rightShoulder: [0, 0, 0.008 * breath],
            hips: [0, 0.004 * Math.sin(t * 0.31), -0.004 * weight],
            leftUpperLeg: [0, 0, 0],
            leftLowerLeg: [0, 0, 0],
            rightUpperLeg: [0, 0, 0],
            rightLowerLeg: [0, 0, 0],
            leftUpperArm: [0.02, 0, 1.38],
            rightUpperArm: [0.02, 0, -1.38],
            leftLowerArm: [0, -0.15, -0.08],
            rightLowerArm: [0, 0.15, 0.08],
            leftHand: [-0.04, 0, -0.04],
            rightHand: [-0.04, 0, 0.04],
        };
        const hands = {
                left: [...NEUTRAL_HAND.left] as V3,
                right: [...NEUTRAL_HAND.right] as V3,
            },
            poles = {
                left: [-0.3, -0.24, -0.035] as V3,
                right: [0.3, -0.24, -0.035] as V3,
            },
            facing = { left: 0, right: 0 },
            wrist = { left: 0, right: 0 },
            orientation = {
                left: [0, -Math.PI / 2, -Math.PI / 2] as V3,
                right: [0, Math.PI / 2, Math.PI / 2] as V3,
            };
        let curiousCurl = 0;
        const expressions: Record<string, number> = {
            MouthSmileLeft: 0.1,
            MouthSmileRight: 0.1,
            EyeBlinkLeft: 0,
            EyeBlinkRight: 0,
            BrowInnerUp: 0,
        };
        let smile = 0.1,
            squint = 0,
            jaw = 0;
        // The head leads; hands settle a little later, followed by the fingers.
        if (mode === "Saluto") {
            const lead = ramp(phase, 0, 5.4),
                arm = ramp(phase, 0.18, 5.4),
                wave = motionCurve(
                    [
                        [0, 0],
                        [1.35, 0],
                        [1.65, 1],
                        [2.85, 1],
                        [3.2, 0],
                        [5.4, 0],
                    ],
                    phase,
                );
            bones.head[2] -= 0.048 * lead;
            bones.head[1] -= 0.035 * lead;
            bones.spine[2] += 0.012 * lead;
            hands.right = mix(hands.right, [0.16, 0.13, -0.17], arm);
            facing.right = arm;
            wrist.right =
                Math.sin((phase - 1.45) * Math.PI * 2 * 1.1) * 0.13 * wave;
            bones.rightShoulder[2] += 0.025 * arm;
            smile += 0.22 * lead;
            squint = 0.1 * lead;
        }
        if (mode === "Contenta") {
            const lead = ramp(phase, 0, 5.2),
                right = ramp(phase, 0.06, 5.2),
                left = ramp(phase, 0.2, 5.2);
            hands.right = mix(hands.right, [-0.04, -0.27, -0.24], right);
            hands.left = mix(hands.left, [0.04, -0.27, -0.24], left);
            facing.right = right;
            facing.left = left;
            orientation.right = [-0.45, 0, Math.PI];
            orientation.left = [-0.45, 0, -Math.PI];
            bones.head[2] += 0.038 * lead;
            bones.head[0] -= 0.018 * lead;
            bones.spine[0] -= 0.008 * lead;
            smile += 0.3 * lead;
            squint = 0.3 * lead;
            jaw = 0.045 * lead;
        }
        if (mode === "Curiosa") {
            const lead = ramp(phase, 0, 5.6),
                arm = ramp(phase, 0.2, 5.6);
            bones.head[2] += 0.075 * lead;
            bones.head[1] -= 0.035 * lead;
            bones.neck[2] += 0.012 * lead;
            hands.right = mix(hands.right, [-0.025, -0.015, -0.2], arm);
            poles.right = [0.27, -0.22, -0.035];
            facing.right = arm;
            orientation.right = [-0.15, 0.8, Math.PI / 2 + 0.12];
            curiousCurl = arm;
            expressions.BrowInnerUp = 0.16 * lead;
            smile += 0.08 * lead;
        }
        if (mode === "Assenso") {
            const nod = motionCurve(
                [
                    [0, 0],
                    [0.45, -0.01],
                    [1.1, 0.065],
                    [1.65, -0.008],
                    [2.2, 0],
                    [4.5, 0],
                ],
                phase,
            );
            bones.head[0] += nod;
            bones.neck[0] += nod * 0.2;
            smile += ramp(phase, 0, 4.5) * 0.12;
        }
        if (mode === "Sbadiglio") {
            const arm = ramp(phase, 0.12, 6.4),
                face = ramp(phase, 0.4, 6.4);
            hands.right = mix(hands.right, [-0.025, 0.015, -0.23], arm);
            facing.right = arm;
            bones.head[0] -= 0.035 * face;
            expressions.EyeBlinkLeft = 0.65 * face;
            expressions.EyeBlinkRight = 0.65 * face;
            jaw = 0.12 * face;
            smile = 0.06;
        }
        if (mode === "Pat-pat" || mode === "Fine carezza") {
            const affection =
                mode === "Pat-pat"
                    ? 1
                    : motionCurve(
                          [
                              [0, 1],
                              [0.25, 1],
                              [1.4, 0],
                              [1.6, 0],
                          ],
                          phase,
                      );
            bones.head[0] += 0.065 * affection;
            bones.head[2] += (0.025 + 0.006 * Math.sin(t * 1.2)) * affection;
            bones.neck[0] += 0.015 * affection;
            expressions.EyeBlinkLeft = 0.62 * affection;
            expressions.EyeBlinkRight = 0.62 * affection;
            smile += 0.24 * affection;
            squint = 0.1 * affection;
        }
        const gazeWeight = mode === "Idle" ? 1 : 0.25;
        bones.head[1] +=
            this.smooth("gaze:x", this.gaze.x, dt, 7) * 0.06 * gazeWeight;
        bones.head[0] +=
            this.smooth("gaze:y", this.gaze.y, dt, 7) * 0.025 * gazeWeight;
        for (const [name, angles] of Object.entries(bones))
            bones[name] = angles.map((v, i) =>
                this.smooth(
                    name + ":" + i,
                    v,
                    dt,
                    name === "head" ? 18 : 14,
                    i === 2 && name === "leftUpperArm"
                        ? 1.38
                        : i === 2 && name === "rightUpperArm"
                          ? -1.38
                          : 0,
                ),
            ) as V3;
        for (const side of ["left", "right"] as const) {
            hands[side] = hands[side].map((v, i) =>
                this.smooth(
                    "hand:" + side + i,
                    v,
                    dt,
                    12,
                    NEUTRAL_HAND[side][i],
                ),
            ) as V3;
            poles[side] = poles[side].map((v, i) =>
                this.smooth(
                    "pole:" + side + i,
                    v,
                    dt,
                    12,
                    (side === "left"
                        ? [-0.3, -0.24, -0.035]
                        : [0.3, -0.24, -0.035])[i],
                ),
            ) as V3;
            orientation[side] = orientation[side].map((v, i) =>
                this.smooth(
                    "orientation:" + side + i,
                    v,
                    dt,
                    12,
                    (side === "left"
                        ? [0, -Math.PI / 2, -Math.PI / 2]
                        : [0, Math.PI / 2, Math.PI / 2])[i],
                ),
            ) as V3;
            facing[side] = this.smooth("facing:" + side, facing[side], dt, 12);
            wrist[side] = this.smooth("wrist:" + side, wrist[side], dt, 17);
            const sign = side === "left" ? -1 : 1;
            for (const finger of ["Index", "Middle", "Ring", "Little"])
                for (const [joint, curl] of [
                    ["Proximal", 0.2],
                    ["Intermediate", 0.27],
                    ["Distal", 0.12],
                ] as const) {
                    const name = side + finger + joint;
                    const extra =
                        side === "right"
                            ? curiousCurl *
                              (finger === "Index"
                                  ? 0
                                  : joint === "Proximal"
                                    ? 0.48
                                    : joint === "Intermediate"
                                      ? 0.58
                                      : 0.2)
                            : 0;
                    bones[name] = [
                        0,
                        sign * (curl * (1 - facing[side] * 0.9) + extra),
                        0,
                    ];
                }
            bones[side + "ThumbProximal"] = [0.06, sign * 0.07, -sign * 0.1];
            bones[side + "ThumbIntermediate"] = [0, sign * 0.07, 0];
        }
        expressions.MouthSmileLeft = smile;
        expressions.MouthSmileRight = smile;
        expressions.EyeSquintLeft = squint;
        expressions.EyeSquintRight = squint;
        expressions.JawOpen = jaw;
        for (const [name, target] of Object.entries(expressions))
            expressions[name] = this.smooth(
                "face:" + name,
                target,
                dt,
                18,
                name.startsWith("MouthSmile") ? 0.1 : 0,
            );
        if (t > this.nextBlink) {
            this.blinkAt = t;
            this.nextBlink = t + 3.4 + this.random() * 3.0;
        }
        const blink = motionCurve(
            [
                [0, 0],
                [0.065, 1],
                [0.1, 1],
                [0.26, 0],
                [0.35, 0],
            ],
            t - this.blinkAt,
        );
        expressions.EyeBlinkLeft = Math.max(
            expressions.EyeBlinkLeft || 0,
            blink,
        );
        expressions.EyeBlinkRight = Math.max(
            expressions.EyeBlinkRight || 0,
            blink,
        );
        const hipShift = [
            this.smooth("hip:x", 0.0045 * weight, dt, 7),
            this.smooth("hip:y", -0.0075, dt, 7),
            0,
        ] as V3;
        return {
            bones,
            hands,
            poles,
            facing,
            wrist,
            orientation,
            hipShift,
            expressions,
            mode,
        };
    }
    snapshot() {
        return {
            mode: this.mode,
            time: this.time,
            hands: ["left", "right"].map((side) =>
                [0, 1, 2].map(
                    (i) =>
                        this.springs.get("hand:" + side + i)?.value ??
                        NEUTRAL_HAND[side][i],
                ),
            ),
        };
    }
}

export function gestureForDialogue(text: string) {
    if (/bentornat|buongiorn|buonaser|ciao|ciao/i.test(text)) return "Saluto";
    if (/cerchi|trova|selezion|articol|disegn|dove|esplor/i.test(text))
        return "Curiosa";
    if (/tutto pronto|pront[io]|perfett|iniziamo|possiamo iniziare/i.test(text))
        return "Contenta";
    return "Assenso";
}

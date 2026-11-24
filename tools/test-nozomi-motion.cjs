const assert = require('node:assert/strict'), esbuild = require('esbuild'), Module = require('module');
const code = esbuild.buildSync({ entryPoints: ['src/renderer/modules/assistant-3d-motion.ts'], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, moduleObject = new Module(__filename); moduleObject._compile(code, __filename); const { AssistantMotion, MotionSpring, SOFT_ANIMATIONS, motionCurve, gestureForDialogue } = moduleObject.exports;
for (const fps of [30, 60, 120]) { const spring = new MotionSpring(); let previous = 0; for (let i = 0; i < fps * 2; i++) { const n = spring.step(1, 1 / fps); assert(n >= previous - 1e-8 && n <= 1); previous = n; } assert(Math.abs(previous - 1) < 1e-6); }
for (const name of SOFT_ANIMATIONS.map(a => a.name)) {
    const motion = new AssistantMotion(() => .5); for (let i = 0; i < 60; i++)motion.update(1 / 60); motion.play(name); let previous = motion.update(1 / 60), maxSpeed = 0;
    for (let i = 0; i < 480; i++) {
        if (i === 100) motion.play('Pat-pat'); if (i === 117) motion.play('Fine carezza'); if (i === 160) motion.play(name); const pose = motion.update(1 / 60); for (const side of ['left', 'right']) { const speed = Math.hypot(...pose.hands[side].map((v, j) => v - previous.hands[side][j])) * 60; maxSpeed = Math.max(maxSpeed, speed); assert(speed < 1.5, name + ': hand discontinuity ' + speed); assert(Math.hypot(...pose.hands[side]) < .53); }
        for (const angles of Object.values(pose.bones)) assert(angles.every(Number.isFinite)); for (const value of Object.values(pose.expressions)) assert(value >= 0 && value <= 1); previous = pose;
    }
    console.log(name, 'max hand speed', maxSpeed.toFixed(3), 'm/s');
}
const settled = []; for (const fps of [30, 60, 120]) { const motion = new AssistantMotion(() => .5); motion.play('Saluto'); let p; for (let i = 0; i < fps * 2; i++)p = motion.update(1 / fps); settled.push(p.hands.right); } assert(Math.hypot(...settled[0].map((n, i) => n - settled[2][i])) < .007, 'Frame-rate independent animation');
assert.equal(gestureForDialogue('Tutto pronto, Sensei!'), 'Contenta'); assert.equal(gestureForDialogue('Cerchi un articolo?'), 'Curiosa'); assert.equal(gestureForDialogue('Bentornato, Sensei'), 'Saluto'); assert.equal(gestureForDialogue('Il calendario si apre qui'), 'Assenso');
console.log('OK: smooth gesture transitions, no hand overshoot/jumps, bounded expressions, 30/60/120 fps, purposeful dialogue gestures.');

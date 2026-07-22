type TrailPoint = { x: number; y: number; time: number };

function initBlueArchivePointerEffects(enabled = true) {
    if (!enabled || document.documentElement.dataset.baPointerEffects === "1") {
        return;
    }
    document.documentElement.dataset.baPointerEffects = "1";

    const layer = document.createElement("div");
    layer.className = "fp-ba-pointer-layer";
    layer.setAttribute("aria-hidden", "true");

    const canvas = document.createElement("canvas");
    canvas.className = "fp-ba-pointer-trail";
    layer.appendChild(canvas);
    document.body.appendChild(layer);

    const context = canvas.getContext("2d");
    const points: TrailPoint[] = [];
    let animationFrame = 0;

    function resizeCanvas() {
        const ratio = Math.max(1, window.devicePixelRatio || 1);
        canvas.width = Math.round(window.innerWidth * ratio);
        canvas.height = Math.round(window.innerHeight * ratio);
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function drawTrail(now: number) {
        if (!context) return;
        const lifetime = 230;
        while (points.length && now - points[0].time > lifetime) {
            points.shift();
        }
        context.clearRect(0, 0, window.innerWidth, window.innerHeight);
        context.lineCap = "round";
        context.lineJoin = "round";

        for (let index = 1; index < points.length; index += 1) {
            const previous = points[index - 1];
            const point = points[index];
            const age = Math.min(1, (now - point.time) / lifetime);
            const position = index / Math.max(1, points.length - 1);
            const opacity = (1 - age) * (0.12 + position * 0.78);
            context.beginPath();
            context.moveTo(previous.x, previous.y);
            context.lineTo(point.x, point.y);
            context.lineWidth = 1.2 + position * 3.4;
            context.strokeStyle = `rgba(${Math.round(105 + position * 145)}, ${Math.round(205 + position * 45)}, 255, ${opacity})`;
            context.shadowColor = `rgba(48, 183, 242, ${opacity * 0.75})`;
            context.shadowBlur = 7;
            context.stroke();
        }

        if (points.length) {
            animationFrame = requestAnimationFrame(drawTrail);
        } else {
            animationFrame = 0;
            context.clearRect(0, 0, window.innerWidth, window.innerHeight);
        }
    }

    function addTrailPoint(x: number, y: number) {
        const now = performance.now();
        const previous = points[points.length - 1];
        if (previous && Math.hypot(x - previous.x, y - previous.y) < 2.5) {
            return;
        }
        points.push({ x, y, time: now });
        if (points.length > 42) points.splice(0, points.length - 42);
        if (!animationFrame) animationFrame = requestAnimationFrame(drawTrail);
    }

    function burst(x: number, y: number) {
        const colors = ["#26bff3", "#1689ed", "#79dcf5", "#ffffff", "#17243d"];
        const ring = document.createElement("i");
        ring.className = "fp-ba-click-ring";
        ring.style.left = `${x}px`;
        ring.style.top = `${y}px`;
        layer.appendChild(ring);
        ring.addEventListener("animationend", () => ring.remove(), { once: true });

        for (let index = 0; index < 10; index += 1) {
            const particle = document.createElement("i");
            particle.className = "fp-ba-click-particle";
            const angle = (Math.PI * 2 * index) / 10 + Math.random() * 0.25;
            const distance = 24 + Math.random() * 36;
            particle.style.left = `${x}px`;
            particle.style.top = `${y}px`;
            particle.style.setProperty("--fp-ba-particle-x", `${Math.cos(angle) * distance}px`);
            particle.style.setProperty("--fp-ba-particle-y", `${Math.sin(angle) * distance}px`);
            particle.style.setProperty("--fp-ba-particle-color", colors[index % colors.length]);
            layer.appendChild(particle);
            particle.addEventListener("animationend", () => particle.remove(), {
                once: true,
            });
        }
    }

    document.addEventListener("mousemove", (event) => {
        addTrailPoint(event.clientX, event.clientY);
    });
    document.addEventListener("mousedown", (event) => {
        if (event.button === 0) burst(event.clientX, event.clientY);
    });
    document.addEventListener("mouseleave", () => {
        points.length = 0;
    });
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();
}

export { initBlueArchivePointerEffects };

(function attachFrequencyVibeRenderer() {
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function mapRange(value, inMin, inMax, outMin, outMax) {
    if (inMax === inMin) return outMin;
    const t = clamp((value - inMin) / (inMax - inMin), 0, 1);
    return outMin + (outMax - outMin) * t;
  }

  class FrequencyVibeRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
      this.frequency = 440;
      this.running = false;
      this.active = false;
      this.time = 0;
      this.rafId = 0;
      this.resizeBound = this.resize.bind(this);
    }

    setFrequency(hz) {
      this.frequency = clamp(Number(hz) || 440, 40, 4000);
    }

    setActive(active) {
      this.active = Boolean(active);
    }

    start() {
      if (!this.ctx || this.running) return;
      this.running = true;
      this.resize();
      window.addEventListener("resize", this.resizeBound);
      this.rafId = window.requestAnimationFrame(this.renderFrame);
    }

    stop() {
      this.running = false;
      if (this.rafId) {
        window.cancelAnimationFrame(this.rafId);
      }
      this.rafId = 0;
      window.removeEventListener("resize", this.resizeBound);
    }

    resize() {
      if (!this.ctx) return;
      const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const width = Math.max(10, Math.floor(this.canvas.clientWidth || 10));
      const height = Math.max(10, Math.floor(this.canvas.clientHeight || 10));
      this.canvas.width = Math.floor(width * ratio);
      this.canvas.height = Math.floor(height * ratio);
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    renderFrame = () => {
      if (!this.running || !this.ctx) return;

      const speedFactor = this.active ? 1 : 0.28;
      this.time += 0.016 * speedFactor;
      this.draw();
      this.rafId = window.requestAnimationFrame(this.renderFrame);
    };

    draw() {
      const ctx = this.ctx;
      const width = this.canvas.clientWidth || 10;
      const height = this.canvas.clientHeight || 10;

      ctx.clearRect(0, 0, width, height);

      const baseHue = mapRange(this.frequency, 40, 4000, 196, 332);
      const horizonY = height * 0.24;
      const ampBase = mapRange(this.frequency, 40, 4000, 5, 24);
      const waveDensity = mapRange(this.frequency, 40, 4000, 0.010, 0.028);
      const waveSpeed = mapRange(this.frequency, 40, 4000, 0.9, 3.2) * (this.active ? 1 : 0.25);

      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0, "rgba(16, 21, 33, 0.2)");
      bgGrad.addColorStop(1, "rgba(8, 10, 17, 0.55)");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 14; i += 1) {
        const t = i / 14;
        const y = horizonY + t * (height - horizonY);
        const leftX = width * (0.5 - (0.5 * (1 - t)));
        const rightX = width * (0.5 + (0.5 * (1 - t)));
        ctx.beginPath();
        ctx.moveTo(leftX, y);
        ctx.lineTo(rightX, y);
        ctx.stroke();
      }

      const laneLeft = width * 0.14;
      const laneRight = width * 0.86;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(width * 0.5, horizonY);
      ctx.lineTo(laneLeft, height);
      ctx.moveTo(width * 0.5, horizonY);
      ctx.lineTo(laneRight, height);
      ctx.stroke();

      const layers = 24;
      for (let layer = layers; layer >= 1; layer -= 1) {
        const depth = layer / layers;
        const perspective = Math.pow(1 - depth, 1.35);
        const yBase = horizonY + depth * (height - horizonY);
        const amp = ampBase * (0.4 + perspective * 2.4);
        const alpha = 0.08 + perspective * 0.42;
        const hue = baseHue + depth * 20;

        ctx.beginPath();
        for (let x = laneLeft; x <= laneRight; x += 4) {
          const phase = this.time * waveSpeed + depth * 8;
          const y =
            yBase +
            Math.sin((x - laneLeft) * waveDensity * (1 + depth) + phase) * amp +
            Math.cos((x - laneLeft) * waveDensity * 0.54 + phase * 1.3) * amp * 0.35;
          if (x === laneLeft) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `hsla(${hue.toFixed(1)}, 92%, ${mapRange(depth, 0, 1, 68, 42).toFixed(1)}%, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1 + perspective * 2.1;
        ctx.stroke();
      }

      const orbRadius = mapRange(this.frequency, 40, 4000, 4, 11);
      const orbY = horizonY + Math.sin(this.time * (1.1 + waveSpeed * 0.2)) * 5;
      const orbGlow = ctx.createRadialGradient(width * 0.5, orbY, 1, width * 0.5, orbY, orbRadius * 6);
      orbGlow.addColorStop(0, `hsla(${baseHue.toFixed(1)}, 100%, 72%, 0.92)`);
      orbGlow.addColorStop(1, `hsla(${(baseHue + 28).toFixed(1)}, 90%, 55%, 0)`);
      ctx.fillStyle = orbGlow;
      ctx.beginPath();
      ctx.arc(width * 0.5, orbY, orbRadius * 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  window.FrequencyVibeRenderer = FrequencyVibeRenderer;
}());

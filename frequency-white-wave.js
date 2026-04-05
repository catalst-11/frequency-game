(function attachWhiteFrequencyWaveRenderer() {
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function mapRange(value, inMin, inMax, outMin, outMax) {
    if (inMax === inMin) return outMin;
    const t = clamp((value - inMin) / (inMax - inMin), 0, 1);
    return outMin + (outMax - outMin) * t;
  }

  class WhiteFrequencyWaveRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
      this.running = false;
      this.active = false;
      this.frequency = 440;
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
      if (this.rafId) window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      window.removeEventListener("resize", this.resizeBound);
    }

    resize() {
      if (!this.ctx || !this.canvas) return;
      const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const width = Math.max(10, Math.floor(this.canvas.clientWidth || 10));
      const height = Math.max(10, Math.floor(this.canvas.clientHeight || 10));
      this.canvas.width = Math.floor(width * ratio);
      this.canvas.height = Math.floor(height * ratio);
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    renderFrame = () => {
      if (!this.running || !this.ctx) return;
      const speed = this.active ? 1 : 0.28;
      this.time += 0.016 * speed;
      this.draw();
      this.rafId = window.requestAnimationFrame(this.renderFrame);
    };

    draw() {
      const ctx = this.ctx;
      const width = this.canvas.clientWidth || 10;
      const height = this.canvas.clientHeight || 10;

      ctx.clearRect(0, 0, width, height);
      const viewSize = Math.max(10, Math.min(width, height));
      const viewOffsetX = (width - viewSize) * 0.5;
      const viewOffsetY = (height - viewSize) * 0.5;

      ctx.save();
      ctx.beginPath();
      ctx.rect(viewOffsetX, viewOffsetY, viewSize, viewSize);
      ctx.clip();
      ctx.translate(viewOffsetX, viewOffsetY);
      ctx.globalCompositeOperation = "source-over";

      const freqForShape = clamp(this.frequency, 70, 2600);
      const freqNorm = clamp(
        (Math.log(freqForShape) - Math.log(70)) / (Math.log(2600) - Math.log(70)),
        0,
        1
      );
      const motion = this.active ? 1 : 0.45;
      const speed = mapRange(freqNorm, 0, 1, 0.8, 2.8) * motion;
      const cycles = mapRange(freqNorm, 0, 1, 1.9, 7.1);
      let amplitude = mapRange(freqNorm, 0, 1, viewSize * 0.08, viewSize * 0.3);
      let stackSpread = mapRange(freqNorm, 0, 1, viewSize * 0.12, viewSize * 0.38);
      const centerY = viewSize * mapRange(freqNorm, 0, 1, 0.54, 0.46);
      const points = Math.max(220, Math.floor(viewSize * 0.92));
      const lineCount = 44;
      const brightness = this.active ? 1.18 : 0.78;
      const maxVertical = viewSize * 0.46;
      const combinedRange = amplitude + stackSpread;
      if (combinedRange > maxVertical) {
        const rangeScale = maxVertical / combinedRange;
        amplitude *= rangeScale;
        stackSpread *= rangeScale;
      }

      ctx.globalCompositeOperation = "lighter";

      const drawWavePath = (lineOffset, phaseOffset, ampScale = 1) => {
        ctx.beginPath();
        for (let i = 0; i <= points; i += 1) {
          const t = i / points;
          const x = t * viewSize;
          const envelope = Math.pow(Math.sin(t * Math.PI), 1.12);
          const primary = Math.sin(t * Math.PI * 2 * cycles + this.time * speed * 2.8 + phaseOffset);
          const secondary = Math.sin(t * Math.PI * 2 * (cycles * 0.42) - this.time * speed * 1.3 - phaseOffset * 0.58);
          const wave = (primary + secondary * 0.35) * amplitude * ampScale;
          const y = centerY + lineOffset * envelope + wave * envelope;
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
      };

      for (let line = 0; line < lineCount; line += 1) {
        const p = line / Math.max(1, lineCount - 1);
        const signed = p * 2 - 1;
        const distanceFromCenter = Math.abs(signed);
        const lineOffset = signed * stackSpread;
        const phaseOffset = signed * 2.25;
        const alpha = (0.17 + (1 - distanceFromCenter) * 0.65) * brightness;
        const thick = 0.8 + (1 - distanceFromCenter) * 1.45;
        const coreAlpha = Math.min(1, alpha * 1.08);

        drawWavePath(lineOffset, phaseOffset, 1);

        const colorLine = ctx.createLinearGradient(0, 0, viewSize, 0);
        colorLine.addColorStop(0, `rgba(84,124,255,${(alpha * 0.88).toFixed(3)})`);
        colorLine.addColorStop(0.18, `rgba(234,66,175,${alpha.toFixed(3)})`);
        colorLine.addColorStop(0.5, `rgba(255,236,170,${coreAlpha.toFixed(3)})`);
        colorLine.addColorStop(0.82, `rgba(131,90,255,${(alpha * 0.95).toFixed(3)})`);
        colorLine.addColorStop(1, `rgba(247,72,164,${(alpha * 0.82).toFixed(3)})`);
        ctx.strokeStyle = colorLine;
        ctx.lineWidth = thick;
        ctx.stroke();

        drawWavePath(lineOffset, phaseOffset, 1);
        ctx.strokeStyle = `rgba(255,255,255,${(alpha * 0.18).toFixed(3)})`;
        ctx.lineWidth = thick + 1.4;
        ctx.stroke();
      }

      drawWavePath(0, 0, 1.03);
      const centerGlow = ctx.createLinearGradient(0, centerY, viewSize, centerY);
      centerGlow.addColorStop(0, "rgba(255,255,255,0.08)");
      centerGlow.addColorStop(0.2, `rgba(97,149,255,${(0.55 * brightness).toFixed(3)})`);
      centerGlow.addColorStop(0.5, `rgba(255,244,196,${(0.98 * brightness).toFixed(3)})`);
      centerGlow.addColorStop(0.8, `rgba(232,95,193,${(0.55 * brightness).toFixed(3)})`);
      centerGlow.addColorStop(1, "rgba(255,255,255,0.08)");
      ctx.strokeStyle = centerGlow;
      ctx.lineWidth = 2.6;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(viewSize, centerY);
      ctx.strokeStyle = `rgba(255,255,255,${(0.5 * brightness).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.globalCompositeOperation = "source-over";
      ctx.restore();
    }
  }

  window.WhiteFrequencyWaveRenderer = WhiteFrequencyWaveRenderer;
}());

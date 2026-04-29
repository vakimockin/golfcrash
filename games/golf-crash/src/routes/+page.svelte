<script lang="ts">
  import { onMount } from "svelte";
  import HUDOverlay from "$lib/ui/HUDOverlay.svelte";
  import { getRuntimeConfig } from "$lib/runtime";
  import { game } from "$lib/stores/game.svelte";
  import { pickWorldByHour } from "$lib/config/worlds";

  let canvas: HTMLCanvasElement;
  let progress = $state(0);
  let ready = $state(false);
  let hideLoader = $state(false);

  onMount(() => {
    const runtime = getRuntimeConfig();
    game.lang = runtime.lang;
    game.demoMode = runtime.demo;
    const world = pickWorldByHour(new Date().getHours());
    game.visualTimeMode =
      world === "golden" ? "evening" : world === "night" ? "night" : "day";
    let teardown: (() => void) | undefined;
    let cancelled = false;
    void import("$lib/game/bootstrap").then(({ bootstrapGame }) => {
      if (cancelled) return;
      teardown = bootstrapGame(canvas, {
        onProgress: (p) => {
          progress = Math.max(progress, p);
        },
        onReady: () => {
          progress = 1;
          ready = true;
          setTimeout(() => {
            hideLoader = true;
          }, 600);
        },
      });
    });
    return () => {
      cancelled = true;
      teardown?.();
    };
  });
</script>

<div class="stage">
  <div class="playfield">
    <canvas bind:this={canvas}></canvas>
  </div>
  <HUDOverlay />

  {#if !hideLoader}
    <div class="loader" class:loader--out={ready} aria-hidden={ready}>
      <div class="loader__sky"></div>
      <div class="loader__stars"></div>
      <div class="loader__content">
        <div class="loader__title">
          <span class="loader__title-main">GOLF</span>
          <span class="loader__title-accent">CRASH</span>
        </div>
        <div class="loader__ball-wrap">
          <div class="loader__trail"></div>
          <div class="loader__ball">
            <div class="loader__ball-dot"></div>
            <div class="loader__ball-dot"></div>
            <div class="loader__ball-dot"></div>
            <div class="loader__ball-dot"></div>
          </div>
        </div>
        <div class="loader__bar">
          <div class="loader__bar-fill" style="width: {Math.round(progress * 100)}%"></div>
        </div>
        <div class="loader__pct">{Math.round(progress * 100)}%</div>
        <div class="loader__hint">
          {#if progress < 0.95}LOADING ASSETS{:else if !ready}WARMING UP{:else}READY{/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .stage {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: #000;
    overflow: hidden;
  }

  .playfield {
    flex: 1;
    position: relative;
    overflow: hidden;
    min-height: 0;
    min-width: 0;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  @media (min-width: 900px) and (orientation: landscape) {
    .stage {
      flex-direction: row;
    }
  }

  .loader {
    position: absolute;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: #050a1f;
    transition: opacity 600ms ease;
  }

  .loader--out {
    opacity: 0;
    pointer-events: none;
  }

  .loader__sky {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 60% 50% at 50% 105%, #ffb86b 0%, transparent 55%),
      radial-gradient(ellipse 80% 60% at 50% 100%, #ff7849 0%, transparent 65%),
      linear-gradient(180deg, #050a1f 0%, #0c1442 35%, #2a3a85 65%, #ffac6a 100%);
  }

  .loader__stars {
    position: absolute;
    inset: 0;
    background-image:
      radial-gradient(1.5px 1.5px at 14% 12%, #fff 50%, transparent 100%),
      radial-gradient(1px 1px at 28% 8%, #fff 50%, transparent 100%),
      radial-gradient(1.5px 1.5px at 44% 18%, #fff 50%, transparent 100%),
      radial-gradient(1px 1px at 60% 6%, #fff 50%, transparent 100%),
      radial-gradient(2px 2px at 72% 14%, #fff 50%, transparent 100%),
      radial-gradient(1px 1px at 86% 22%, #fff 50%, transparent 100%),
      radial-gradient(1.5px 1.5px at 8% 28%, #fff 50%, transparent 100%),
      radial-gradient(1px 1px at 92% 34%, #fff 50%, transparent 100%),
      radial-gradient(1px 1px at 36% 30%, #fff 50%, transparent 100%),
      radial-gradient(1.5px 1.5px at 52% 36%, #fff 50%, transparent 100%);
    opacity: 0.85;
    animation: starsTwinkle 3.6s ease-in-out infinite;
  }

  @keyframes starsTwinkle {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 0.95; }
  }

  .loader__content {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    padding: 32px;
  }

  .loader__title {
    font-family: system-ui, -apple-system, sans-serif;
    font-weight: 900;
    font-size: clamp(36px, 7vw, 64px);
    letter-spacing: 4px;
    display: flex;
    gap: 14px;
    text-shadow: 0 4px 24px rgba(0, 0, 0, 0.6);
  }

  .loader__title-main {
    color: #fff;
  }

  .loader__title-accent {
    background: linear-gradient(180deg, #6cd0ff 0%, #2a7fd6 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .loader__ball-wrap {
    position: relative;
    width: 220px;
    height: 100px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .loader__trail {
    position: absolute;
    left: 0;
    top: 50%;
    width: 140px;
    height: 36px;
    transform: translateY(-50%);
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(91, 200, 255, 0.18) 20%,
      rgba(91, 200, 255, 0.6) 60%,
      rgba(180, 240, 255, 0.95) 100%
    );
    filter: blur(6px);
    border-radius: 50%;
    animation: trailPulse 0.9s ease-in-out infinite alternate;
  }

  @keyframes trailPulse {
    0% { opacity: 0.7; transform: translateY(-50%) scaleX(0.85); }
    100% { opacity: 1; transform: translateY(-50%) scaleX(1.1); }
  }

  .loader__ball {
    position: relative;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background:
      radial-gradient(circle at 35% 30%, #ffffff 0%, #e6eef7 45%, #b8c4d4 100%);
    box-shadow:
      0 0 28px rgba(108, 208, 255, 0.85),
      0 0 56px rgba(108, 208, 255, 0.45),
      inset -4px -6px 10px rgba(0, 0, 0, 0.18);
    margin-left: 90px;
    animation: ballHover 1.2s ease-in-out infinite alternate;
  }

  @keyframes ballHover {
    0% { transform: translateY(-2px) rotate(-4deg); }
    100% { transform: translateY(2px) rotate(4deg); }
  }

  .loader__ball-dot {
    position: absolute;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.18);
  }

  .loader__ball-dot:nth-child(1) { top: 14px; left: 18px; }
  .loader__ball-dot:nth-child(2) { top: 14px; right: 14px; }
  .loader__ball-dot:nth-child(3) { bottom: 14px; left: 24px; }
  .loader__ball-dot:nth-child(4) { bottom: 16px; right: 20px; }

  .loader__bar {
    width: min(360px, 70vw);
    height: 8px;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    overflow: hidden;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
  }

  .loader__bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #6cd0ff 0%, #b4f0ff 50%, #6cd0ff 100%);
    background-size: 200% 100%;
    border-radius: 999px;
    box-shadow: 0 0 12px rgba(108, 208, 255, 0.7);
    transition: width 240ms ease;
    animation: barShine 1.6s linear infinite;
  }

  @keyframes barShine {
    0% { background-position: 0% 0%; }
    100% { background-position: 200% 0%; }
  }

  .loader__pct {
    font-family: system-ui, -apple-system, sans-serif;
    font-weight: 700;
    font-size: 18px;
    color: #cfe6ff;
    letter-spacing: 2px;
  }

  .loader__hint {
    font-family: system-ui, -apple-system, sans-serif;
    font-weight: 600;
    font-size: 12px;
    letter-spacing: 4px;
    color: rgba(207, 230, 255, 0.6);
    text-transform: uppercase;
  }
</style>

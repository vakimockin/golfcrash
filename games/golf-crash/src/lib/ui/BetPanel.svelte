<script lang="ts">
  import {
    MAX_BET_MICRO,
    MICRO,
    MIN_BET_MICRO,
    microToUnit,
  } from "@golf-crash/utils-shared";
  import { game, adjustBet, setBet } from "$lib/stores/game.svelte";
  import { t } from "$lib/i18n";

  const PRESETS = [0.1, 0.2, 0.4, 0.8];
  const MAX_BET_UNIT = MAX_BET_MICRO / MICRO;
  const MIN_BET_UNIT = MIN_BET_MICRO / MICRO;

  let editing = $state(false);
  let draft = $state("");

  const beginEdit = (): void => {
    draft = microToUnit(game.betMicro).toFixed(2);
    editing = true;
  };

  const commitEdit = (): void => {
    const parsed = Number.parseFloat(draft.replace(",", "."));
    if (Number.isFinite(parsed) && parsed > 0) {
      const clamped = Math.min(MAX_BET_UNIT, Math.max(MIN_BET_UNIT, parsed));
      setBet(Math.round(clamped * MICRO));
    }
    editing = false;
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      (event.currentTarget as HTMLInputElement).blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      editing = false;
    }
  };
</script>

<div class="bet">
  <div class="row">
    <button class="step" onclick={() => adjustBet(-10)} aria-label={t(game.lang, "decreaseBet")}
      >−</button
    >
    <input
      class="amount"
      type="text"
      inputmode="decimal"
      maxlength="6"
      aria-label="bet amount"
      value={editing ? draft : microToUnit(game.betMicro).toFixed(2)}
      oninput={(e) => (draft = (e.currentTarget as HTMLInputElement).value)}
      onfocus={beginEdit}
      onblur={commitEdit}
      onkeydown={onKeydown}
    />
    <button class="step" onclick={() => adjustBet(10)} aria-label={t(game.lang, "increaseBet")}
      >+</button
    >
  </div>

  <div class="presets">
    {#each PRESETS as preset}
      <button
        class="preset"
        class:active={Math.abs(microToUnit(game.betMicro) - preset) < 0.001}
        onclick={() => setBet(preset * MICRO)}
      >
        {preset.toFixed(1)}
      </button>
    {/each}
  </div>
</div>

<style>
  .bet {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .row {
    display: flex;
    align-items: center;
    background: #1a1c1f;
    border-radius: 7px;
    overflow: hidden;
  }

  .step {
    width: 38px;
    height: 30px;
    border: none;
    background: transparent;
    color: #fff;
    font-size: 18px;
    cursor: pointer;
  }

  .step:active {
    background: #0f1011;
  }

  .amount {
    flex: 1;
    width: 100%;
    min-width: 0;
    text-align: center;
    font-size: 13px;
    font-weight: 600;
    color: #fff;
    background: transparent;
    border: none;
    padding: 0;
    font-family: inherit;
    appearance: none;
    -moz-appearance: textfield;
  }

  .amount:focus {
    outline: none;
    background: #0f1011;
  }

  .amount::-webkit-outer-spin-button,
  .amount::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .presets {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 5px;
  }

  .preset {
    height: 26px;
    border: 1px solid #3a3d42;
    background: #1a1c1f;
    color: #cfd2d6;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .preset.active {
    background: #ffb627;
    color: #2c2f33;
    border-color: #ffb627;
  }

  @media (min-width: 900px) and (orientation: landscape) {
    .step {
      width: 48px;
      height: 40px;
      font-size: 22px;
    }

    .amount {
      font-size: 16px;
    }

    .preset {
      height: 34px;
      font-size: 14px;
    }
  }
</style>

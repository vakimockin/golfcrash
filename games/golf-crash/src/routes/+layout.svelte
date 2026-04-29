<script lang="ts">
  let { children } = $props();

  if (import.meta.env.DEV && typeof window !== "undefined") {
    void import("$lib/dev/terminalLogger");
  }
</script>

{@render children()}

<style>
  :global(html, body, #app) {
    margin: 0;
    padding: 0;
    height: 100%;
    background: #000;
    color: #fff;
    font-family: system-ui, sans-serif;
    overflow: hidden;
    overscroll-behavior: none;
  }
</style>

// Dev-only: pipes browser console output to the Vite dev-server terminal.
// Loaded conditionally from +layout.svelte under `import.meta.env.DEV`.

const LEVELS = ["log", "info", "warn", "error", "debug"] as const;
type Level = (typeof LEVELS)[number];

const safe = (value: unknown): unknown => {
  if (value instanceof Error)
    return { __err: true, message: value.message, stack: value.stack };
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }
  return value;
};

const install = (): void => {
  if (!import.meta.hot) return;
  const hot = import.meta.hot;
  const send = (level: Level, args: unknown[]): void => {
    try {
      hot.send("golf-crash:log", { level, args: args.map(safe) });
    } catch {
      /* swallow — never break the page on logger failure */
    }
  };

  for (const level of LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]): void => {
      send(level, args);
      original(...args);
    };
  }

  window.addEventListener("error", (e) => {
    send("error", [`${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`]);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason as { message?: string } | string | undefined;
    const msg =
      typeof reason === "string"
        ? reason
        : (reason?.message ?? JSON.stringify(reason));
    send("error", [`unhandled rejection: ${msg}`]);
  });
};

install();

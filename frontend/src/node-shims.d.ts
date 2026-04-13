declare module 'node:crypto' {
  export function randomUUID(): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

declare module 'node:path' {
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
}

declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function readFile(path: string, encoding: string): Promise<string>;
  export function writeFile(path: string, data: string, encoding: string): Promise<void>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

declare module 'node:child_process' {
  export type ChildProcessWithoutNullStreams = {
    killed: boolean;
    kill(signal?: string): boolean;
    once(event: 'exit', listener: () => void): void;
    stdout: { on(event: 'data', listener: (chunk: unknown) => void): void };
    stderr: { on(event: 'data', listener: (chunk: unknown) => void): void };
  };

  export function spawn(
    command: string,
    args?: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
    },
  ): ChildProcessWithoutNullStreams;

  export function spawnSync(
    command: string,
    args?: string[],
    options?: { stdio?: string },
  ): { status: number | null };
}

declare const process: {
  env: Record<string, string | undefined>;
};
